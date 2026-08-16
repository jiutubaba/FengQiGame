import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

const DEFAULT_FOCAL = [0.5, 0.5];
const DEFAULT_ROTATION = [1, 0];
const MOBILE_QUERY = "(max-width: 680px)";

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform bool uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uAutoCenterRepulsion;
uniform bool uTransparent;

varying vec2 vUv;

#define NUM_LAYER 4.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float tri(float x) {
  return abs(fract(x) * 2.0 - 1.0);
}

float tris(float x) {
  float t = fract(x);
  return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0));
}

float trisn(float x) {
  float t = fract(x);
  return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = (0.05 * uGlowIntensity) / d;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.3 * flare * uGlowIntensity;
  m *= smoothstep(1.0, 0.2, d);
  return m;
}

vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv) - 0.5;
  vec2 id = floor(uv);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + offset;
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;

      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
      float grn = min(red, blu) * seed;
      vec3 base = vec3(red, grn, blu);

      float hue = atan(base.g - base.r, base.b - base.r) / (2.0 * 3.14159) + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;
      float val = max(max(base.r, base.g), base.b);
      base = hsv2rgb(vec3(hue, sat, val));

      vec2 pad = vec2(
        tris(seed * 34.0 + uTime * uSpeed / 10.0),
        tris(seed * 38.0 + uTime * uSpeed / 30.0)
      ) - 0.5;

      float star = Star(gv - offset - pad, flareSize);
      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
      twinkle = mix(1.0, twinkle, uTwinkleIntensity);
      star *= twinkle;

      col += star * size * base;
    }
  }

  return col;
}

void main() {
  vec2 focalPx = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;
  vec2 mouseNorm = uMouse - vec2(0.5);

  if (uAutoCenterRepulsion > 0.0) {
    float centerDist = length(uv);
    if (centerDist > 0.0001) {
      vec2 repulsion = normalize(uv) * (uAutoCenterRepulsion / (centerDist + 0.1));
      uv += repulsion * 0.05;
    }
  } else if (uMouseRepulsion) {
    vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
    float mouseDist = length(uv - mousePosUV);
    if (mouseDist > 0.0001) {
      vec2 repulsion = normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1));
      uv += repulsion * 0.05 * uMouseActiveFactor;
    }
  } else {
    uv += mouseNorm * 0.1 * uMouseActiveFactor;
  }

  float autoRotAngle = uTime * uRotationSpeed;
  mat2 autoRot = mat2(
    cos(autoRotAngle),
    -sin(autoRotAngle),
    sin(autoRotAngle),
    cos(autoRotAngle)
  );
  uv = autoRot * uv;
  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;

  vec3 col = vec3(0.0);
  for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYER) {
    float depth = fract(i + uStarSpeed * uSpeed);
    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + i * 453.32) * fade;
  }

  if (uTransparent) {
    float alpha = smoothstep(0.0, 0.3, length(col));
    gl_FragColor = vec4(col, min(alpha, 1.0));
  } else {
    gl_FragColor = vec4(col, 1.0);
  }
}
`;

export default function Galaxy({
  focal = DEFAULT_FOCAL,
  rotation = DEFAULT_ROTATION,
  starSpeed = 0.5,
  density = 1,
  hueShift = 140,
  disableAnimation = false,
  speed = 1,
  mouseInteraction = true,
  glowIntensity = 0.3,
  saturation = 0,
  mouseRepulsion = true,
  repulsionStrength = 2,
  twinkleIntensity = 0.3,
  rotationSpeed = 0.1,
  autoCenterRepulsion = 0,
  transparent = true,
  className = "",
  ...rest
}) {
  const containerRef = useRef(null);
  const focalX = focal[0] ?? DEFAULT_FOCAL[0];
  const focalY = focal[1] ?? DEFAULT_FOCAL[1];
  const rotationX = rotation[0] ?? DEFAULT_ROTATION[0];
  const rotationY = rotation[1] ?? DEFAULT_ROTATION[1];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let renderer;
    try {
      renderer = new Renderer({
        alpha: transparent,
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        premultipliedAlpha: false,
      });
    } catch {
      container.dataset.galaxyState = "unavailable";
      return undefined;
    }

    const gl = renderer.gl;
    if (transparent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } else {
      gl.clearColor(0, 0, 0, 1);
    }

    const resolution = new Float32Array([1, 1, 1]);
    const mouse = new Float32Array([0.5, 0.5]);
    const targetMouse = { x: 0.5, y: 0.5 };
    const smoothMouse = { x: 0.5, y: 0.5 };
    let targetMouseActive = 0;
    let smoothMouseActive = 0;

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: resolution },
        uFocal: { value: new Float32Array([focalX, focalY]) },
        uRotation: { value: new Float32Array([rotationX, rotationY]) },
        uStarSpeed: { value: 0 },
        uDensity: { value: density },
        uHueShift: { value: hueShift },
        uSpeed: { value: speed },
        uMouse: { value: mouse },
        uGlowIntensity: { value: glowIntensity },
        uSaturation: { value: saturation },
        uMouseRepulsion: { value: mouseRepulsion },
        uTwinkleIntensity: { value: twinkleIntensity },
        uRotationSpeed: { value: rotationSpeed },
        uRepulsionStrength: { value: repulsionStrength },
        uMouseActiveFactor: { value: 0 },
        uAutoCenterRepulsion: { value: autoCenterRepulsion },
        uTransparent: { value: transparent },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    const canvas = gl.canvas;
    canvas.className = "galaxy-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    container.appendChild(canvas);
    container.dataset.galaxyState = "ready";

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileLayout = window.matchMedia(MOBILE_QUERY);
    let animationFrame = 0;
    let isAnimating = false;
    let isIntersecting = true;

    const canAnimate = () =>
      !disableAnimation &&
      !reducedMotion.matches &&
      !mobileLayout.matches &&
      !document.hidden &&
      isIntersecting &&
      canvas.width > 1 &&
      canvas.height > 1;

    const render = (time = 0, animate = false) => {
      if (animate) {
        program.uniforms.uTime.value = time * 0.001;
        program.uniforms.uStarSpeed.value = (time * 0.001 * starSpeed) / 10;
        const lerpFactor = 0.05;
        smoothMouse.x += (targetMouse.x - smoothMouse.x) * lerpFactor;
        smoothMouse.y += (targetMouse.y - smoothMouse.y) * lerpFactor;
        smoothMouseActive +=
          (targetMouseActive - smoothMouseActive) * lerpFactor;
      } else {
        program.uniforms.uTime.value = 0;
        program.uniforms.uStarSpeed.value = 0;
        smoothMouseActive = 0;
      }

      mouse[0] = smoothMouse.x;
      mouse[1] = smoothMouse.y;
      program.uniforms.uMouseActiveFactor.value = smoothMouseActive;
      renderer.render({ scene: mesh });
    };

    const frame = (time) => {
      if (!canAnimate()) {
        isAnimating = false;
        animationFrame = 0;
        render();
        return;
      }
      render(time, true);
      animationFrame = requestAnimationFrame(frame);
    };

    const syncAnimation = () => {
      if (canAnimate()) {
        if (!isAnimating) {
          isAnimating = true;
          animationFrame = requestAnimationFrame(frame);
        }
        return;
      }
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      isAnimating = false;
      render();
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      renderer.setSize(width, height);
      resolution[0] = canvas.width;
      resolution[1] = canvas.height;
      resolution[2] = canvas.width / canvas.height;
      render();
      syncAnimation();
    });
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isIntersecting = entry.isIntersecting;
        syncAnimation();
      },
      { threshold: 0.01 },
    );
    intersectionObserver.observe(container);

    const interactionTarget = container.parentElement || container;
    const handlePointerMove = (event) => {
      if (!mouseInteraction || !canAnimate()) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      targetMouse.x = (event.clientX - rect.left) / rect.width;
      targetMouse.y = 1 - (event.clientY - rect.top) / rect.height;
      targetMouseActive = 1;
    };
    const handlePointerLeave = () => {
      targetMouseActive = 0;
    };
    if (mouseInteraction) {
      interactionTarget.addEventListener("pointermove", handlePointerMove);
      interactionTarget.addEventListener("pointerleave", handlePointerLeave);
    }

    const handleEnvironmentChange = () => syncAnimation();
    document.addEventListener("visibilitychange", handleEnvironmentChange);
    reducedMotion.addEventListener("change", handleEnvironmentChange);
    mobileLayout.addEventListener("change", handleEnvironmentChange);
    syncAnimation();

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleEnvironmentChange);
      reducedMotion.removeEventListener("change", handleEnvironmentChange);
      mobileLayout.removeEventListener("change", handleEnvironmentChange);
      if (mouseInteraction) {
        interactionTarget.removeEventListener("pointermove", handlePointerMove);
        interactionTarget.removeEventListener(
          "pointerleave",
          handlePointerLeave,
        );
      }
      if (container.contains(canvas)) container.removeChild(canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      delete container.dataset.galaxyState;
    };
  }, [
    autoCenterRepulsion,
    density,
    disableAnimation,
    focalX,
    focalY,
    glowIntensity,
    hueShift,
    mouseInteraction,
    mouseRepulsion,
    repulsionStrength,
    rotationSpeed,
    rotationX,
    rotationY,
    saturation,
    speed,
    starSpeed,
    transparent,
    twinkleIntensity,
  ]);

  const classes = ["galaxy-container", className].filter(Boolean).join(" ");

  return (
    <div {...rest} ref={containerRef} className={classes} aria-hidden="true" />
  );
}
