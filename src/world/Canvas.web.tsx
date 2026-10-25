import React, { ComponentProps, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Canvas as WebCanvas } from '@react-three/fiber';
import { GameText } from '../ui/GameText';
import { ToyButton } from '../ui/Toy';
import { AdaptiveResolution } from './AdaptiveResolution';
export { createPortal, useFrame, useThree } from '@react-three/fiber';

export function Canvas(props: ComponentProps<typeof WebCanvas>) {
  const { width } = useWindowDimensions();
  const maxDpr = width < 768 ? 1.5 : 1.75;
  // Same starting ratio as R3F's `dpr={[1, maxDpr]}`; AdaptiveResolution tunes it from there.
  const [dpr,setDpr]=useState(()=>Math.min(maxDpr,Math.max(1,typeof window!=='undefined'?window.devicePixelRatio||1:1)));
  const [lost,setLost]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const cleanup=useRef<()=>void>(()=>{});
  useEffect(()=>()=>cleanup.current(),[]);
  if(lost) return <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:15}}>
    <GameText size={18} font="bold">Graphics were interrupted. Your puzzle is safe!</GameText>
    <ToyButton title="Restore graphics" tint="blue" height={50} fontSize={18} onPress={()=>{cleanup.current();setAttempt(n=>n+1);setLost(false);}}/>
  </View>;
  return <WebCanvas key={attempt} dpr={dpr} {...props} onCreated={state=>{
    const canvas=state.gl.domElement;
    const onLost=(event:Event)=>{event.preventDefault();console.warn('WebGL context lost; graphics recovery is available.');setLost(true);};
    cleanup.current();
    canvas.addEventListener('webglcontextlost',onLost);
    cleanup.current=()=>canvas.removeEventListener('webglcontextlost',onLost);
    props.onCreated?.(state);
  }}>{props.children}<AdaptiveResolution maxDpr={maxDpr} dpr={dpr} onChange={setDpr} /></WebCanvas>;
}
