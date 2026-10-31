# The plot language

A plot is a fenced code block tagged `plot`. Each line is one statement. Blank lines and `#` comments are ignored. Statements are independent and order does not matter, except that a name must be defined somewhere in the block before it can be used.

````markdown
```plot
y = sin(a x)
a = 1 in [0, 4]
```
````

A block whose statements use only `x` and `y` is a 2D plot. A block that mentions `z`, a three-component point, or a surface is a 3D plot.

## Equations

| Form | Meaning |
| --- | --- |
| `y = x^2 - 2` | explicit curve `y = f(x)` |
| `x = y^2` | explicit curve `x = f(y)` |
| `f(x) = x^3 - x` | defines `f` and plots `y = f(x)` |
| `g(t) = t^2` | defines `g` only (parameter is not `x`) |
| `r = 1 + cos(theta)` | polar curve, `theta` in `[0, 2pi]` by default |
| `x^2 + y^2 = 1` | implicit curve `F(x, y) = 0` |
| `y < x^2` | shaded region (also `<=`, `>`, `>=`), 2D only |
| `z = x^2 - y^2` | explicit surface `z = f(x, y)` |
| `x^2 + y^2 + z^2 = 1` | implicit surface `F(x, y, z) = 0` |
| `(cos t, sin t)` | parametric curve, `t` in `[0, 2pi]` by default |
| `(cos t, sin t, t / 4)` | parametric space curve |
| `(u, v, u v)` | parametric surface in `u` and `v`, each `[-2, 2]` by default |
| `x = 2` | vertical line (`y = 3` is horizontal; `z = 0` is a plane) |

Add `for <variable> in [a, b]` to restrict a domain or set a parameter range:

```plot
y = sqrt(x) for x in [0, 9]
(t cos t, t sin t) for t in [0, 6pi]
(u, v, sin(u) cos(v)) for u in [-pi, pi], v in [-pi, pi]
```

## Parameters

A name with a constant value is a parameter. Add `in [min, max]` to give it a slider, and `step` to snap it.

```plot
a = 2
k = 1 in [0, 5]
n = 3 in [1, 10] step 1
```

Parameters can be used in any expression, including points and view ranges. Reserved names (`x`, `y`, `z`, `r`, `theta`) cannot be parameters. `t`, `u` and `v` are ordinary names: they are parametric variables only when the block does not define them, so `(cos t, sin t)` is a curve, and with `t = 1 in [0, 6]` it is a point that moves with the slider.

## Geometry

Coordinates are expressions, so they may use parameters.

```plot
a = 1
point (1, 2)
point (cos a, sin a, 0)
segment (0, 0) to (1, 1)
vector (1, 2)                  # arrow from the origin
vector (1, 1) to (3, 2)        # arrow from (1, 1)
circle (0, 0) radius 1
arc (0, 0) radius 0.4 from 0 to a   # angle arc, radians, counterclockwise
polygon (0, 0) (2, 0) (1, 1.5)
label "unit circle" at (1.1, 1.1)
```

## View

By default the view fits the content. Set explicit ranges when the natural window is unclear.

```plot
view x [-5, 5]
view x [-2, 2] y [-1, 3]
view z [0, 4]
```

2D axes always keep equal scale; a range is the least that must be visible. 3D plots are shown inside the box the ranges describe, and axes without a range fit the content.

## Attributes

Any statement may end with `{ ... }` holding comma-separated attributes.

```plot
y = sin x { label: "sine", color: blue }
y = cos x { label: "cosine", dashed }
x^2 + y^2 = 1 { hidden }
```

| Attribute | Values |
| --- | --- |
| `label: "text"` | shown near the curve, point or surface |
| `color: name` | `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`, or `#rrggbb` |
| `dashed` | dashed stroke |
| `hidden` | defined but not drawn (useful for helper functions) |

Colors are assigned automatically from a palette when omitted.

## Expressions

- Operators: `+ - * / ^` with the usual precedence; `^` is right associative; unary minus binds looser than `^` (`-x^2` is `-(x^2)`). Exponents bind tightly: `e^2x` is `(e^2) x`, so write `e^(2x)`; `1/2x` is `(1/2) x`.
- Implicit multiplication: `2x`, `a x`, `x y`, `2 sin x`, `(x+1)(x-1)`. Write a space between single-letter names; `ab` with no space is the product of `a` and `b` only when `ab` itself is not defined.
- Function application works with or without parentheses: `sin(x)`, `sin x`, `sin 2x` means `sin(2x)`, `sin x^2` means `sin(x^2)`, `sin x + 1` means `sin(x) + 1`, `sin x cos x` means `sin(x) cos(x)`.
- `|x|` is absolute value. `x!` is not supported.
- Functions: `sin cos tan asin acos atan atan2 sinh cosh tanh exp ln log log2 log10 sqrt abs floor ceil round sign min max mod`.
- Constants: `pi` (or `π`), `tau`, `e`. `theta` may be written `θ`.
- Comparison: `=`, `<`, `>`, `<=`, `>=`, and `≤`, `≥`.
- Names are letters and digits, optionally followed by `_` and more characters: `x1`, `a_max`, `theta`. The variables `x y z r theta`, the words `for in step to radius from at` and the geometry keywords are reserved; `t`, `u` and `v` may be defined.
- A tuple with no free variable, like `(1, 2)`, is a point. In a 3D plot, an equation in `x` and `y` alone extends along `z`: `x^2 + y^2 = 1` is a cylinder.

## Errors

A line that cannot be understood is reported with its line number and does not stop the rest of the plot from rendering.

## Examples

Trigonometric circle with a draggable angle:

```plot
a = 0.8 in [0, 2pi]
circle (0, 0) radius 1
point (cos a, sin a) { label: "(cos a, sin a)" }
segment (0, 0) to (cos a, sin a)
segment (cos a, 0) to (cos a, sin a) { color: red, dashed, label: "sin a" }
segment (0, 0) to (cos a, 0) { color: blue, label: "cos a" }
arc (0, 0) radius 0.25 from 0 to a
view x [-1.5, 1.5] y [-1.5, 1.5]
```

Tangent line at a movable point:

```plot
f(x) = x^3 - 3x
h = 1 in [-2.5, 2.5]
m = 3h^2 - 3
y = m (x - h) + f(h) { color: orange, label: "tangent" }
point (h, f(h))
```

Saddle surface and a sphere:

```plot
z = x^2 - y^2 for x in [-2, 2], y in [-2, 2]
x^2 + y^2 + z^2 = 1 { color: blue }
```
