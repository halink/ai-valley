shader_type spatial;
render_mode unshaded, shadows_disabled, depth_draw_never, cull_disabled;

uniform vec2 board_size = vec2(32.0, 24.0);

void fragment() {
	vec2 projected = (UV - 0.5) * (board_size + 14.0) - vec2(0.8, 0.9);
	vec2 margin = max(abs(projected) - board_size * 0.49, vec2(0.0));
	float falloff = 1.0 - smoothstep(0.0, 4.0, length(margin));
	ALBEDO = vec3(0.23, 0.26, 0.19);
	ALPHA = falloff * falloff * 0.25;
}
