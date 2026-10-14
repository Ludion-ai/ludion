// The site's water (apps/site/src/scripts/water.js), driven by the film's clock instead of the wall clock: the same
// caustic net of light, a surface line that can rise, swell and ring, and a flood of light for the moment a lesson
// lands. Black and white only.
const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime, uSurface, uSwell, uLight, uLine, uAbove, uScale, uFlood, uFocus, uFocusY, uGlitch;
uniform vec3 uHit;      // x, y (px), seconds since the ring started (< 0: none)
uniform vec3 uHit2;
out vec4 o;

vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float h1(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f*f*(3.0 - 2.0*f);
  float a = dot(h2(i) - 0.5, f), b = dot(h2(i + vec2(1, 0)) - 0.5, f - vec2(1, 0));
  float c = dot(h2(i + vec2(0, 1)) - 0.5, f - vec2(0, 1)), d = dot(h2(i + vec2(1, 1)) - 0.5, f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }

float net(vec2 x, float t, float w){
  vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j), r = h2(n + g);
    vec2 q = g + 0.5 + 0.42*sin(t*0.55 + 6.2831*r) - f;
    float d = dot(q, q);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  float e = 1.0 - smoothstep(0.0, w, sqrt(d2) - sqrt(d1));
  return e * e;
}

float ring(vec2 px, vec3 h, out float flash){
  flash = 0.0;
  if (h.z < 0.0) return 0.0;
  float r = length(px - h.xy);
  float front = h.z * 900.0;
  float env = exp(-h.z * 1.6) * exp(-abs(r - front) * 0.012);
  flash = exp(-h.z * 3.0) * exp(-r * 0.002);
  return env;
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float s = uRes.y / 1080.0;                      // the net's cell size follows the frame's height
  vec2 q = px / s;
  float t = uTime;
  // Tearing: shift whole rows sideways.
  if (uGlitch > 0.0) {
    float band = floor(q.y / 23.0);
    float k = step(0.72, h1(band + floor(t * 30.0) * 7.0));
    q.x += (h1(band * 3.1 + floor(t * 30.0)) - 0.5) * 160.0 * uGlitch * k;
  }
  float ys = uSurface / s + uSwell * (6.0*sin(q.x*0.0042 + t*0.9) + 3.0*sin(q.x*0.0117 - t*1.3));
  float f1, f2;
  float r1 = ring(q, vec3(uHit.xy / s, uHit.z), f1);
  float r2 = ring(q, vec3(uHit2.xy / s, uHit2.z), f2);
  ys += 10.0 * (r1 + r2);
  float d = q.y - ys;
  float below = max(smoothstep(-0.8, 0.8, d), uAbove);
  float dd = max(d, 0.0) * (1.0 - uAbove);
  vec2 w = vec2(gn(q/170.0 + t*0.03), gn(q/170.0 + 9.1 - t*0.03)) * 2.0
         + vec2(gn(q/60.0 - t*0.05), gn(q/60.0 + 3.3 + t*0.05)) * 0.45;
  vec2 cp = q / (vec2(150.0, 98.0) * uScale) + w + vec2(0.0, (r1 + r2) * 0.6);
  float deep = 1.0 - exp(-abs(d)/180.0);
  float width = mix(0.07, 0.20, deep) * (0.8 + 0.4*gn(q/90.0 + 5.0));
  float c = net(cp, t, width) + 0.35*net(cp*1.8 + 4.0, t*1.15, width*1.2);
  float patchy = 0.35 + 0.65*smoothstep(-0.25, 0.35, gn(q/420.0 + vec2(t*0.015, 0.0)));
  c *= patchy * below * mix(exp(-dd/320.0), 1.0, uAbove);
  // A soft pool of focus, so the light gathers where the words are.
  vec2 fq = (px - vec2(uRes.x*0.5, uRes.y*uFocusY)) / uRes.yy;
  float focus = mix(1.0, 0.25 + 0.95*exp(-dot(fq, fq)*2.4), uFocus);
  float light = c * uLight * focus;
  float line = exp(-d*d/1.6) * uLine * (1.0 - uAbove);
  float glow = below * exp(-dd/30.0) * uLine * 0.12 * (1.0 - uAbove);
  float flood = uFlood * (0.55 + 0.45*c) * focus;
  float v = light + line + glow + flood + (f1 + f2) * 0.35;
  // Vignette: the corners fall away a little, like a lens.
  vec2 vq = px / uRes - 0.5;
  v *= 1.0 - 0.55 * dot(vq, vq);
  o = vec4(vec3(v), 1.0);
}`;

export function createWater(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL2 is required to render the film");
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ["uRes", "uTime", "uSurface", "uSwell", "uLight", "uLine", "uAbove", "uScale", "uFlood", "uFocus", "uFocusY", "uGlitch", "uHit", "uHit2"]) U[n] = gl.getUniformLocation(prog, n);

  return function draw(p) {
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, p.time);
    gl.uniform1f(U.uSurface, p.surface);
    gl.uniform1f(U.uSwell, p.swell ?? 1);
    gl.uniform1f(U.uLight, p.light);
    gl.uniform1f(U.uLine, p.line ?? 0);
    gl.uniform1f(U.uAbove, p.above ?? 0);
    gl.uniform1f(U.uScale, p.scale ?? 1);
    gl.uniform1f(U.uFlood, p.flood ?? 0);
    gl.uniform1f(U.uFocus, p.focus ?? 0);
    gl.uniform1f(U.uFocusY, p.focusY ?? 0.5);
    gl.uniform1f(U.uGlitch, p.glitch ?? 0);
    const h = p.hit ?? [0, 0, -1];
    const h2 = p.hit2 ?? [0, 0, -1];
    gl.uniform3f(U.uHit, h[0], h[1], h[2]);
    gl.uniform3f(U.uHit2, h2[0], h2[1], h2[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
