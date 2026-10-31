export const promptReference = `Plots: write a fenced \`\`\`plot block, one statement per line, # for comments. Statements may appear in any order.
Equations:
y = x^2 - 2 (also x = y^2) | f(x) = x^3 - x (defines f and plots it; g(t) = t^2 only defines) | r = 1 + cos(theta) (polar)
x^2 + y^2 = 1 (implicit) | y < x^2 (shaded region, also <= > >=, 2D only) | x = 2 (vertical line)
(cos t, sin t) (parametric, t in [0, 2pi]) | (cos t, sin t, t/4) (space curve)
z = x^2 - y^2 (surface) | x^2 + y^2 + z^2 = 1 (implicit surface) | (u, v, u v) (u, v in [-2, 2])
Domains: y = sqrt(x) for x in [0, 9]; (u, v, sin(u) cos(v)) for u in [-pi, pi], v in [-pi, pi]
Parameters: a = 2; k = 1 in [0, 5] (slider); n = 3 in [1, 10] step 1. Reserved: x y z r theta; t, u, v are curve/surface variables unless defined (then a slider moves the point).
Geometry (coordinates may use parameters): point (1, 2); point (1, 2, 0); segment (0, 0) to (1, 1); vector (1, 2); vector (1, 1) to (3, 2); circle (0, 0) radius 1; arc (0, 0) radius 0.4 from 0 to a; polygon (0, 0) (2, 0) (1, 1.5); label "text" at (1, 1)
View: view x [-2, 2] y [-1, 3]; view z [0, 4]
Attributes end a line: { label: "tangent", color: red|orange|yellow|green|teal|blue|purple|pink|gray|#rrggbb, dashed, hidden }
Expressions: + - * / ^, implicit multiplication (2x, a x, (x+1)(x-1)), sin x = sin(x), |x|, pi, e. Functions: sin cos tan asin acos atan atan2 sinh cosh tanh exp ln log log2 sqrt abs floor ceil round sign min max mod.
Rules: prefer parameters with sliders for anything the learner should explore; give explicit view ranges when the interesting region is not near the origin; never put prose inside the block.`;
