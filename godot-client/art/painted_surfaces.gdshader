// Original procedural painted-color study, MIT, 2026 AI Valley contributors.
// Static opaque color only: no displacement, transparency or simulation state.
shader_type spatial;
render_mode diffuse_burley, specular_disabled;
uniform vec4 pigment : source_color = vec4(0.5, 0.5, 0.5, 1.0);
uniform int surface_kind = 0; // 0 slate, 1 timber, 2 water, 3 stone
varying vec3 world_point;
varying vec3 world_normal;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wash(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash21(cell),hash21(cell+vec2(1,0)),f.x),
        mix(hash21(cell+vec2(0,1)),hash21(cell+vec2(1,1)),f.x),f.y);
}
void vertex() {
    world_point = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    world_normal = normalize(MODEL_NORMAL_MATRIX * NORMAL);
}
float paint(vec2 p) {
    // Broad pigment washes; restrained contrast so residents stay the focal point.
    float mark = (wash(p*vec2(2.8,1.3))-0.5)*0.10;
    if (surface_kind == 0) {
        vec2 q = p*vec2(1.7,2.2);
        q.x += mod(floor(q.y),2.0)*0.5;
        vec2 f = fract(q);
        float seam = 1.0-smoothstep(0.025,0.085,min(f.x,f.y));
        mark += (hash21(floor(q))-0.5)*0.09 - seam*0.12;
    } else if (surface_kind == 1) {
        float grain = sin(p.x*19.0 + wash(p*vec2(1.8,0.6))*4.0);
        mark += grain*0.025 + (wash(p*vec2(7.0,0.65))-0.5)*0.08;
        mark -= (1.0-smoothstep(0.015,0.055,fract(p.x*1.7)))*0.08;
    } else if (surface_kind == 2) {
        // Painted ripples, not a fabricated flowing-water simulation.
        float stroke = sin(p.y*9.0 + wash(p*0.7)*5.0);
        mark += smoothstep(0.86,1.0,stroke)*0.07;
    } else {
        mark += (wash(p*4.3)-0.5)*0.10;
    }
    return mark;
}
void fragment() {
    vec3 weights = pow(abs(normalize(world_normal)),vec3(8.0));
    weights /= max(dot(weights,vec3(1.0)),0.0001);
    float marks = paint(world_point.zy)*weights.x + paint(world_point.xz)*weights.y + paint(world_point.xy)*weights.z;
    ALBEDO = clamp(pigment.rgb + vec3(marks),vec3(0.0),vec3(1.0));
    ROUGHNESS = 1.0;
    METALLIC = 0.0;
}
