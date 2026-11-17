shader_type spatial;
render_mode diffuse_burley, specular_disabled;

uniform vec4 skin : source_color = vec4(0.91, 0.72, 0.54, 1.0);
uniform vec4 hair : source_color = vec4(0.28, 0.2, 0.16, 1.0);
uniform vec4 shirt : source_color = vec4(0.65, 0.36, 0.26, 1.0);

void fragment() {
	float dye = UV2.x;
	vec3 paint = COLOR.rgb;
	if (dye > 0.5 && dye < 1.5) {
		paint *= skin.rgb;
	} else if (dye > 1.5 && dye < 2.5) {
		float lock = sin(UV.x * 86.0 + .8 * sin(UV.y * 8.0));
		paint *= hair.rgb * (1.0 + lock * .095 * (1.0 - smoothstep(.4, 1.2, fwidth(UV.x * 86.0))));
	} else if (dye > 2.5 && dye < 3.5) {
		paint *= shirt.rgb;
	}
	if (dye > 2.5) {
		vec2 weave = UV * vec2(207.0, 142.0);
		vec2 footprint = fwidth(weave);
		float fiber = sin(weave.x + .35 * sin(weave.y * .09)) * cos(weave.y);
		paint += fiber * .026 * (1.0 - smoothstep(.35, 1.15, max(footprint.x, footprint.y)));
	}
	ALBEDO = clamp(paint, vec3(0.0), vec3(1.0));
	ROUGHNESS = 1.0;
}
