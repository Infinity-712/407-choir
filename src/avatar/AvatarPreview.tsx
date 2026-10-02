import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AvatarConfig } from '../../shared/protocol.ts';
import { createAvatar, type AvatarInstance } from './AvatarRig.ts';

type PreviewProps = { config: AvatarConfig; className?: string; lowQuality?: boolean };

export function AvatarPreview({ config, className = '', lowQuality = false }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<{ scene: THREE.Scene; avatar: AvatarInstance; yaw: number; config: AvatarConfig; setQuality: (low: boolean) => void } | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const qualityRef = useRef(lowQuality);
  qualityRef.current = lowQuality;
  const [error, setError] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setError(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityRef.current ? 1 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = !qualityRef.current;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;';
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 20);
    camera.position.set(0, 0.9, 3.05);
    camera.lookAt(0, 0.7, 0);
    scene.add(new THREE.HemisphereLight('#fff3e1', '#8f9db3', 1.4));
    const key = new THREE.DirectionalLight('#ffead3', 2.4);
    key.position.set(-2.2, 3.2, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 2;
    key.shadow.camera.bottom = -1;
    key.shadow.normalBias = 0.012;
    key.shadow.bias = -0.0002;
    key.shadow.radius = 3;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#cddfff', 1.65);
    rim.position.set(2, 2.2, -2);
    scene.add(rim);
    const floorGeometry = new THREE.CircleGeometry(0.77, 64);
    const floorMaterial = new THREE.ShadowMaterial({ color: '#655167', opacity: 0.15 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.008;
    floor.receiveShadow = true;
    scene.add(floor);
    const runtime = { scene, avatar: createAvatar(configRef.current), yaw: -0.13, config: configRef.current, setQuality: (low: boolean) => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1 : 1.5));
      renderer.shadowMap.enabled = !low;
      resize();
    } };
    runtimeRef.current = runtime;
    scene.add(runtime.avatar.group);
    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = camera.aspect < 0.8 ? 3.05 / (camera.aspect / 0.8) : 3.05;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let pointer: number | null = null;
    let lastX = 0;
    const down = (event: PointerEvent) => {
      pointer = event.pointerId;
      lastX = event.clientX;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      runtime.yaw += (event.clientX - lastX) * 0.012;
      lastX = event.clientX;
    };
    const up = () => { pointer = null; renderer.domElement.style.cursor = 'grab'; };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        runtime.yaw += event.key === 'ArrowLeft' ? -0.15 : 0.15;
        event.preventDefault();
      }
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    container.addEventListener('keydown', keydown);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const started = performance.now();
    let frame = 0;
    let lastRendered = -Infinity;
    const render = (now: number) => {
      if (document.hidden) { frame = 0; return; }
      frame = requestAnimationFrame(render);
      const interval = 1000 / (qualityRef.current ? 30 : 60);
      if (now - lastRendered < interval - 0.5) return;
      lastRendered = now;
      const time = reducedMotion.matches ? 0 : (now - started) / 1000;
      runtime.avatar.animate(time, { mode: 'walk', speed: 0, emote: null });
      runtime.avatar.group.rotation.y = runtime.yaw;
      renderer.render(scene, camera);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastRendered = -Infinity;
      if (!document.hidden) frame = requestAnimationFrame(render);
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      container.removeEventListener('keydown', keydown);
      runtime.avatar.dispose();
      runtimeRef.current = null;
      floorGeometry.dispose();
      floorMaterial.dispose();
      key.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.config === config) return;
    runtime.avatar.dispose();
    runtime.avatar = createAvatar(config);
    runtime.config = config;
    runtime.scene.add(runtime.avatar.group);
  }, [config]);

  useEffect(() => { runtimeRef.current?.setQuality(lowQuality); }, [lowQuality]);

  return <div ref={containerRef} className={`avatar-preview ${className}`} role="img" aria-label="三维形象预览，可拖动或使用左右方向键旋转" tabIndex={0} style={{ width: '100%', height: '100%', minHeight: 260, position: 'relative' }}>
    {error && <p role="status">当前设备暂时无法显示三维预览，请启用浏览器硬件加速。</p>}
  </div>;
}
