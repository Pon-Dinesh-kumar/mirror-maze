package expo.modules.googleplay

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "PlayBilling"

/**
 * Google Play Billing for one-time (non-consumable) products, such as Remove Ads. Purchases are checked on the device
 * only: there is no server, so an owned product is whatever Google Play reports for the signed-in Play account.
 *
 * All state lives on the main thread: every function runs there and every Billing callback is posted back to it.
 */
class PlayBillingModule : Module() {
  private var client: BillingClient? = null
  private var connecting = false
  /** Work waiting for the connection to finish setting up. */
  private val waiting = mutableListOf<(BillingResult) -> Unit>()
  private val details = mutableMapOf<String, ProductDetails>()
  /** The purchase flow on screen; Google Play reports its outcome to the purchases listener. */
  private var buying: Promise? = null
  private val main = Handler(Looper.getMainLooper())

  private val listener = PurchasesUpdatedListener { result, purchases -> main.post { purchasesUpdated(result, purchases.orEmpty()) } }

  override fun definition() = ModuleDefinition {
    Name("PlayBilling")
    Events("onPurchase")

    OnDestroy {
      client?.endConnection()
      client = null
    }

    // The product's store listing in the player's currency, or null if Google Play has no such product for this app.
    AsyncFunction("product") { id: String, promise: Promise ->
      connected(promise) { billing ->
        query(billing, id) { result, product ->
          when {
            product != null -> promise.resolve(describe(product))
            result.responseCode == BillingResponseCode.OK -> promise.resolve(null)
            else -> promise.reject("ERR_BILLING", failure("Product query", result), null)
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    // Whether the Play account owns the product. Also acknowledges any purchase that has not been yet (Google Play
    // refunds purchases left unacknowledged for three days).
    AsyncFunction("owned") { id: String, promise: Promise ->
      connected(promise) { billing ->
        billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build()) { result, purchases ->
          main.post {
            if (result.responseCode != BillingResponseCode.OK) {
              promise.reject("ERR_BILLING", failure("Purchase query", result), null)
              return@post
            }
            val owned = purchases.filter { id in it.products && it.purchaseState == Purchase.PurchaseState.PURCHASED }
            owned.forEach { acknowledge(billing, it) }
            promise.resolve(owned.isNotEmpty())
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    // Opens Google Play's purchase sheet. Resolves with the outcome: purchased, pending, cancelled, owned, unavailable
    // or failed, plus the products now owned.
    AsyncFunction("buy") { id: String, promise: Promise ->
      if (buying != null) {
        promise.resolve(outcome("failed", "A purchase is already in progress"))
        return@AsyncFunction
      }
      connected(promise) { billing ->
        val launch = launch@{ product: ProductDetails ->
          val activity = appContext.currentActivity
          if (activity == null) {
            promise.reject(Exceptions.MissingActivity())
            return@launch
          }
          val offer = product.oneTimePurchaseOfferDetailsList?.firstOrNull()?.offerToken
          val item = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product)
          if (offer != null) item.setOfferToken(offer)
          buying = promise
          val result = billing.launchBillingFlow(activity, BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(item.build())).build())
          if (result.responseCode != BillingResponseCode.OK) {
            buying = null
            promise.resolve(outcome(status(result.responseCode), result.debugMessage))
          }
        }
        val known = details[id]
        if (known != null) launch(known)
        else query(billing, id) { result, product ->
          if (product != null) launch(product)
          else promise.resolve(outcome(if (result.responseCode == BillingResponseCode.OK) "unavailable" else status(result.responseCode), result.debugMessage))
        }
      }
    }.runOnQueue(Queues.MAIN)
  }

  /** Runs `work` once Google Play Billing is connected, or rejects the promise if it cannot connect. */
  private fun connected(promise: Promise, work: (BillingClient) -> Unit) {
    val context = appContext.reactContext
    if (context == null) {
      promise.reject(Exceptions.ReactContextLost())
      return
    }
    val billing = client ?: BillingClient.newBuilder(context)
      .setListener(listener)
      .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
      .enableAutoServiceReconnection()
      .build()
      .also { client = it }
    if (billing.isReady) {
      work(billing)
      return
    }
    waiting += { result ->
      if (result.responseCode == BillingResponseCode.OK) work(billing)
      else promise.reject("ERR_BILLING", failure("Google Play Billing", result), null)
    }
    if (connecting) return
    connecting = true
    billing.startConnection(object : BillingClientStateListener {
      override fun onBillingSetupFinished(result: BillingResult) {
        main.post { settle(result) }
      }

      override fun onBillingServiceDisconnected() {
        main.post { settle(BillingResult.newBuilder().setResponseCode(BillingResponseCode.SERVICE_DISCONNECTED).build()) }
      }
    })
  }

  private fun settle(result: BillingResult) {
    connecting = false
    val queued = waiting.toList()
    waiting.clear()
    queued.forEach { it(result) }
  }

  private fun query(billing: BillingClient, id: String, done: (BillingResult, ProductDetails?) -> Unit) {
    val product = QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(ProductType.INAPP).build()
    billing.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()) { result, found ->
      main.post {
        val match = found.productDetailsList.firstOrNull { it.productId == id }
        if (match != null) details[id] = match
        done(result, match)
      }
    }
  }

  private fun purchasesUpdated(result: BillingResult, purchases: List<Purchase>) {
    val purchased = purchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
    client?.let { billing -> purchased.forEach { acknowledge(billing, it) } }
    val code = result.responseCode
    val state = when {
      code == BillingResponseCode.OK && purchased.isNotEmpty() -> "purchased"
      code == BillingResponseCode.OK && purchases.any { it.purchaseState == Purchase.PurchaseState.PENDING } -> "pending"
      code == BillingResponseCode.OK -> "failed"
      else -> status(code)
    }
    val payload = outcome(state, result.debugMessage, purchased.flatMap { it.products })
    val flow = buying
    buying = null
    // Outside a purchase flow this is a pending purchase completing later; the game listens for it.
    if (flow != null) flow.resolve(payload) else sendEvent("onPurchase", payload)
  }

  private fun acknowledge(billing: BillingClient, purchase: Purchase) {
    if (purchase.isAcknowledged) return
    billing.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()) { result ->
      if (result.responseCode != BillingResponseCode.OK) Log.w(TAG, failure("Acknowledge", result))
    }
  }

  private fun describe(product: ProductDetails): Map<String, Any?> {
    val offer = product.oneTimePurchaseOfferDetailsList?.firstOrNull() ?: product.oneTimePurchaseOfferDetails
    return mapOf("id" to product.productId, "title" to product.name, "price" to offer?.formattedPrice)
  }

  private fun status(code: Int) = when (code) {
    BillingResponseCode.USER_CANCELED -> "cancelled"
    BillingResponseCode.ITEM_ALREADY_OWNED -> "owned"
    BillingResponseCode.ITEM_UNAVAILABLE, BillingResponseCode.BILLING_UNAVAILABLE, BillingResponseCode.FEATURE_NOT_SUPPORTED -> "unavailable"
    else -> "failed"
  }

  private fun outcome(status: String, message: String, products: List<String> = emptyList()) =
    mapOf("status" to status, "message" to message, "products" to products)

  private fun failure(what: String, result: BillingResult) = "$what failed (${result.responseCode}): ${result.debugMessage}"
}
