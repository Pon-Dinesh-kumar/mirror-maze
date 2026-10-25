import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShaderMaterial } from 'three';
import { disposeShader } from '../world/fx';

const make = (fragment: string) => new ShaderMaterial({ vertexShader: 'void main(){ gl_Position = vec4(0.); }', fragmentShader: fragment });
const disposals = (m: ShaderMaterial) => { let n = 0; m.addEventListener('dispose', () => { n++; }); return () => n; };

test('disposeShader keeps the first material of each shader so its compiled program survives level changes', () => {
  const first = make('void main(){ gl_FragColor = vec4(1.); }'), second = make('void main(){ gl_FragColor = vec4(1.); }');
  const other = make('void main(){ gl_FragColor = vec4(0.); }');
  const [a, b, c] = [disposals(first), disposals(second), disposals(other)];
  disposeShader(first);
  disposeShader(second);
  disposeShader(other);
  assert.equal(a(), 0, 'the first material of a shader is kept');
  assert.equal(b(), 1, 'later materials of the same shader are disposed normally');
  assert.equal(c(), 0, 'a different shader keeps its own first material');
});
