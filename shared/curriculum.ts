import type { Exercise, Module } from './types';

// Original problems and explanations. The linked texts are optional further reading.
export const modules: Module[] = [
  {
    id: 'functions', subject: 'math', phase: 1, title: 'Algebra as a model', frenchTitle: 'Fonctions et équations',
    summary: 'Recover a rule from measurements and use it to predict a physical quantity.',
    primer: String.raw`A function assigns one output to each input. It lets us express a measurement as a rule, then predict values or work backward from a desired output. In the affine model $y=ax+b$ (fonction affine), $x$ is the input, $y$ the output, $b$ the value at zero, and $a=\Delta y/\Delta x$ the slope: how much the output changes per unit of input.

For example, a tank contains $7$ litres initially and fills at $3$ litres per minute. Its volume is $V(t)=7+3t$, with $t$ measured in minutes and $V$ in litres. After $2$ minutes it contains $13$ litres. To find when it reaches $19$ litres, solve $7+3t=19$, giving $t=4$ minutes. Substitution checks the result.

Units explain the coefficients: the slope has units L/min and the intercept has units L. A quadratic includes an $x^2$ term and can describe a turning point; setting its output to zero locates a possible boundary.

Always check the model's domain. A filling rule applies only while water enters at that rate and the tank has room; an algebraic answer outside that interval is not a physical prediction.`,
    objectives: ['Find slope and intercept from two observations', 'Solve a model equation and check its domain'],
    prerequisites: [], exerciseIds: ['sensor-calibration', 'lamp-arc'],
    resources: [{ title: 'OpenStax: Functions and Function Notation', url: 'https://openstax.org/books/college-algebra-2e/pages/3-1-functions-and-function-notation' }],
  },
  {
    id: 'units-vectors', subject: 'physics', phase: 1, title: 'Units and vectors', frenchTitle: 'Unités et vecteurs',
    summary: 'Use dimensions to test a formula and components to describe displacement.',
    primer: String.raw`Units give algebra a physical meaning. An equation must have the same dimensions on both sides, and quantities being added must have matching dimensions. Write $L$ for length and $T$ for time. In $d=ct^2$, dimensional consistency requires $[c]=L/T^2$ because $[d]=L$. Convert to one consistent unit system before calculating; the square applies to the unit as well as the number. This check can reject a formula, but cannot establish its numerical coefficient.

A vector also records direction. Choose axes, for example east as positive $x$ and north as positive $y$. A planar displacement is $\vec r=(x,y)$; its components share length units. Add vectors component by component, then use $|\vec r|=\sqrt{x^2+y^2}$ for the resultant length.

For example, moving $6$ m east and $8$ m north gives $(6,8)$ m and a displacement magnitude of $10$ m. The distance walked is $14$ m: both legs contribute to the path, while displacement connects only the endpoints.

A useful check is that displacement magnitude never exceeds path length. Keep component signs throughout; taking absolute values before addition loses cancellations and therefore loses direction.`,
    objectives: ['Check a model by dimensional analysis', 'Add displacement vectors and distinguish path length from displacement'],
    prerequisites: ['functions'], exerciseIds: ['drone-scale', 'field-walk'],
    resources: [
      { title: 'OpenStax: Dimensional Analysis', url: 'https://openstax.org/books/university-physics-volume-1/pages/1-4-dimensional-analysis' },
      { title: 'OpenStax: Vector Components', url: 'https://openstax.org/books/university-physics-volume-1/pages/2-2-coordinate-systems-and-components-of-a-vector' },
    ],
  },
  {
    id: 'derivatives', subject: 'math', phase: 2, title: 'Rates from derivatives', frenchTitle: 'Dérivées et taux de variation',
    summary: 'Turn a changing quantity into its instantaneous rate.',
    primer: String.raw`A derivative describes how fast a quantity changes at one instant. Over a finite interval, $[f(t+h)-f(t)]/h$ is an average rate, the slope of a secant line. Shrinking that interval gives the tangent slope:
$$f'(t)=\lim_{h\to0}\frac{f(t+h)-f(t)}{h}.$$
Here $h$ is a small change in the input, not the input itself. The derivative has output units divided by input units.

For example, let $q(t)=t^2+4$ litres, with $t$ measured in minutes. Expanding the difference quotient gives $(2th+h^2)/h=2t+h$ for $h\ne0$. Taking the limit yields $q'(t)=2t$ L/min, so the instantaneous rate at $t=3$ min is $6$ L/min. The constant $4$ disappears because it does not change.

The power rule $d(t^n)/dt=nt^{n-1}$ makes polynomial rates quicker to calculate. A positive derivative means increasing output; a negative derivative means decreasing output.

At a stationary point, $f'=0$. Classify it using signs on either side: positive to negative gives a local maximum, negative to positive a local minimum. Zero slope alone does not guarantee either; $t^3$ keeps increasing through zero.`,
    objectives: ['Derive a polynomial rate', 'Interpret stationary points and units'],
    prerequisites: ['functions'], exerciseIds: ['track-tangent', 'signal-peaks'],
    resources: [{ title: 'OpenStax: Defining the Derivative', url: 'https://openstax.org/books/calculus-volume-1/pages/3-1-defining-the-derivative' }],
  },
  {
    id: 'kinematics', subject: 'physics', phase: 2, title: 'Motion from position', frenchTitle: 'Cinématique',
    summary: 'Read velocity and acceleration from a position model.',
    primer: String.raw`In one-dimensional motion, choose an origin and a positive direction before writing the position $x(t)$. Velocity $v=dx/dt$ measures how position changes; acceleration $a=dv/dt=d^2x/dt^2$ measures how velocity changes. With position in metres and time in seconds, their units are m/s and m/s$^2$. Speed is the nonnegative magnitude $|v|$.

For example, take $x(t)=5-4t+t^2$ metres, using seconds for $t$. Differentiation gives $v(t)=-4+2t$ m/s and $a(t)=2$ m/s$^2$. At $t=1$ s, velocity is $-2$ m/s: the object moves toward decreasing $x$. Its positive acceleration reduces the magnitude of that negative velocity, so it slows down.

At $t=2$ s, velocity is zero. Immediately afterward, velocity is positive and increasing: the same acceleration now increases speed. This distinguishes stopping at an instant from remaining at rest over an interval.

Check the signs of both $v$ and $a$: opposite signs mean decreasing speed, matching signs mean increasing speed where $v\ne0$. Negative acceleration by itself does not mean braking. Accept a stopping time only if it lies inside the position model's stated domain.`,
    objectives: ['Differentiate position to get velocity and acceleration', 'Find a stopping time and test its physical meaning'],
    prerequisites: ['derivatives', 'units-vectors'], exerciseIds: ['cart-speed', 'braking-cart'],
    resources: [{ title: 'OpenStax: Instantaneous Velocity and Speed', url: 'https://openstax.org/books/university-physics-volume-1/pages/3-2-instantaneous-velocity-and-speed' }],
  },
  {
    id: 'integrals', subject: 'math', phase: 3, title: 'Accumulation and signed area', frenchTitle: 'Intégrales et aire signée',
    summary: 'Reconstruct a total change by adding small contributions.',
    primer: String.raw`An integral reconstructs a total change from a rate. Over a small time interval $\Delta t$, velocity contributes approximately $v(t)\Delta t$ to displacement. Adding these thin strips and taking a limit gives a definite integral. If $F'=f$, the fundamental theorem makes the sum calculable:
$$\int_a^b f(t)\,dt=F(b)-F(a).$$
The bounds $a,b$ specify the input interval; $F$ is an antiderivative, not the original rate.

For example, suppose a trolley has $v(t)=1+t$ m/s from $t=0$ to $t=2$ s. An antiderivative is $t+t^2/2$, so its displacement is $[t+t^2/2]_0^2=4$ m. Rate units multiplied by time units give metres, as required. This is a change in position; finding the final position also requires the initial position.

Velocity below zero contributes negative signed area. Total distance instead uses $\int_a^b|v(t)|\,dt$: locate reversals and split the interval wherever velocity changes sign. When velocity stays nonnegative, distance and displacement agree.

Check both endpoints when evaluating an antiderivative. Its arbitrary constant cancels in the subtraction, and differentiating it should recover the integrand.`,
    objectives: ['Evaluate an integral using an antiderivative', 'Separate displacement from distance'],
    prerequisites: ['derivatives'], exerciseIds: ['conveyor-total', 'out-and-back'],
    resources: [{ title: 'OpenStax: The Definite Integral', url: 'https://openstax.org/books/calculus-volume-1/pages/5-2-the-definite-integral' }],
  },
  {
    id: 'work-energy', subject: 'physics', phase: 3, title: 'Work and energy', frenchTitle: 'Travail et énergie',
    summary: 'Use an integral for variable force and a balance for speed.',
    primer: String.raw`Work measures energy transferred by a force acting through a displacement. In one dimension,
$$W=\int_{x_i}^{x_f}F(x)\,dx,$$
where $F$ is the signed force component along the chosen axis. Its unit is the joule: $1$ J $=1$ N m. A force pointing against the displacement does negative work. For variable force, use the area under the force-position graph rather than multiplying the final force by the whole distance.

For example, an applied force $F(x)=4x$ N, with $x$ in metres, moves an object from $0$ to $1$ m. Its work is $[2x^2]_0^1=2$ J; the coefficient $4$ carries units N/m. This is the work of that particular force.

The work-energy theorem uses the net work of all forces: $W_{\rm net}=K_f-K_i$, where $K=mv^2/2$, $m$ is mass and $v$ is speed. Gravity can instead be tracked through potential energy $U_g=mgh$, with height $h$ increasing upward.

Choose one consistent balance: count gravity's work or its potential-energy change, without counting both. Sliding friction contributes negative work; include it explicitly. Finally, check that the predicted kinetic energy is nonnegative.`,
    objectives: ['Integrate a position-dependent force', 'Set up an energy balance with loss'],
    prerequisites: ['integrals', 'kinematics'], exerciseIds: ['stretch-spring', 'rough-ramp'],
    resources: [{ title: 'OpenStax: Work', url: 'https://openstax.org/books/university-physics-volume-1/pages/7-1-work' }],
  },
  {
    id: 'linear-systems', subject: 'math', phase: 4, title: 'Linear systems and matrices', frenchTitle: 'Systèmes linéaires et matrices',
    summary: 'Solve coupled constraints and use a determinant as a uniqueness check.',
    primer: String.raw`A linear system describes unknown quantities constrained by several observations at once. Each equation alone may allow many pairs; the solution must satisfy every equation simultaneously. Elimination removes one unknown by adding suitable multiples of equations. This works because the same operation is applied to both sides.

For example, solve $x+y=7$ and $2x-y=2$. Adding the equations gives $3x=9$, hence $x=3$. Substitution into the first gives $y=4$. Check both: $3+4=7$ and $2(3)-4=2$. The checks use the original constraints, where a sign error is easiest to detect.

Matrix notation packages the same information as
$$A\mathbf{u}=\mathbf{b},\qquad A=\begin{pmatrix}1&1\\2&-1\end{pmatrix},\quad \mathbf{u}=\begin{pmatrix}x\\y\end{pmatrix},\quad \mathbf{b}=\begin{pmatrix}7\\2\end{pmatrix}.$$
Each matrix row produces one equation by multiplying its entries by the corresponding unknowns and adding.

For $A=\begin{pmatrix}a&b\\c&d\end{pmatrix}$, the determinant is $ad-bc$. Here it is $-3\ne0$, so the solution is unique. A zero determinant needs further checking: the equations may be redundant or inconsistent. Keep the unknown order consistent in every row and retain any physical units when substituting.`,
    objectives: ['Solve a two-equation system', 'Translate between equations and matrix form'],
    prerequisites: ['functions'], exerciseIds: ['two-sensors', 'matrix-check'],
    resources: [{ title: 'OpenStax: Matrices and Matrix Operations', url: 'https://openstax.org/books/college-algebra-2e/pages/7-5-matrices-and-matrix-operations' }],
  },
  {
    id: 'circuits', subject: 'physics', phase: 4, title: 'Circuits as constraints', frenchTitle: 'Circuits et lois de Kirchhoff',
    summary: 'Combine Ohm’s law with conservation of charge and loop voltage.',
    primer: String.raw`Circuit equations express conservation laws. Ohm's law, $V=IR$, relates the voltage across a resistor to its current and resistance. Their units are volts (V), amperes (A), and ohms ($\Omega$), with $1\,\Omega=1$ V/A. At a junction, total incoming current equals total outgoing current: charge does not accumulate in the ideal steady circuit.

Around a closed loop, signed voltage rises and drops sum to zero. Choose a traversal direction. Crossing a resistor in its assumed current direction gives a drop $-IR$; crossing an ideal source from its negative terminal to its positive terminal gives a rise.

For example, a $9$ V source feeds $2\,\Omega$ and $7\,\Omega$ resistors in series. The same current passes through both, so the loop equation is $9-2I-7I=0$. Thus $I=1$ A, and the drops $2$ V and $7$ V add to the source voltage.

For parallel branches, equal voltage follows from their shared two nodes. For coupled meshes, a shared resistor carries the algebraic combination of mesh currents. Draw directions before writing equations; a negative answer means actual flow opposes the assumed arrow, not that the calculation failed.`,
    objectives: ['Apply junction and loop rules', 'Solve a coupled two-loop circuit'],
    prerequisites: ['linear-systems', 'units-vectors'], exerciseIds: ['parallel-branches', 'coupled-loops'],
    resources: [{ title: "OpenStax: Kirchhoff's Rules", url: 'https://openstax.org/books/university-physics-volume-2/pages/10-3-kirchhoffs-rules' }],
  },
  {
    id: 'differential-equations', subject: 'math', phase: 5, title: 'Differential equations', frenchTitle: 'Équations différentielles',
    summary: 'Connect a rate law with its trajectory and a numerical approximation.',
    primer: String.raw`A differential equation specifies a rate rather than giving the trajectory directly. In $y'=-ky$, the current value $y$ determines its own rate of change. For constant $k>0$ and positive $y$, larger values fall faster. An initial condition selects one trajectory from the family
$$y(t)=y(0)e^{-kt}.$$
The coefficient $k$ has inverse-time units, so the exponent $kt$ is dimensionless.

For example, a concentration obeys $y'=-2y$ with $t$ in hours and $y(0)=3$ mg/L. Try $y(t)=3e^{-2t}$ mg/L. Differentiating gives $y'=-6e^{-2t}$ mg/L/h, exactly $-2y$; also $y(0)=3$. After half an hour the concentration is $3/e$ mg/L. Checking both the equation and the initial value is essential.

Euler's method approximates a trajectory using its current slope. For $y'=f(t,y)$ and step size $h$, advance time by $h$ and set $y_{n+1}=y_n+h f(t_n,y_n)$. With the example above and $h=0.1$ h, the first estimate is $3+0.1(-6)=2.4$ mg/L.

Use the old value when calculating each step. Smaller steps generally improve accuracy for a smooth equation over a fixed interval; a large step can even make a positive decaying quantity incorrectly become negative.`,
    objectives: ['Verify a first-order exponential solution', 'Perform Euler steps and compare with an exact value'],
    prerequisites: ['derivatives', 'integrals'], exerciseIds: ['cooling-law', 'euler-decay'],
    resources: [{ title: 'OpenStax: Basics of Differential Equations', url: 'https://openstax.org/books/calculus-volume-2/pages/4-1-basics-of-differential-equations' }],
  },
  {
    id: 'oscillators', subject: 'physics', phase: 5, title: 'Oscillations', frenchTitle: 'Oscillations harmoniques',
    summary: 'Read the motion and energy of a spring from its differential equation.',
    primer: String.raw`An ideal spring exerts a restoring force: displacement $x$ from equilibrium produces force $-kx$, pointing back toward equilibrium. Newton's law gives $mx''=-kx$, where $m$ is mass in kg and $k$ is stiffness in N/m. The ideal model neglects damping and any external driving force.

A solution is $x(t)=A\cos(\omega t+\phi)$ with $\omega=\sqrt{k/m}$. The amplitude $A$ is the greatest displacement magnitude, and phase $\phi$ sets the starting point in the cycle. Angular frequency $\omega$ is measured in rad/s; the period $T=2\pi/\omega$ is the time for one complete cycle.

For example, $m=2$ kg and $k=18$ N/m give $\omega=3$ rad/s and $T=2\pi/3$ s. With $A=0.20$ m and $\phi=0$, velocity is $v(t)=-0.60\sin(3t)$ m/s, so maximum speed is $0.60$ m/s. At maximum extension, velocity is zero even though acceleration is not.

Spring energy $kx^2/2$ and kinetic energy $mv^2/2$ exchange while their sum stays constant. Speed is greatest at equilibrium. Check the factor $\omega$ when differentiating the cosine, and distinguish angular frequency from ordinary frequency $1/T$.`,
    objectives: ['Find angular frequency and period', 'Verify motion and energy at a specified time'],
    prerequisites: ['differential-equations', 'work-energy'], exerciseIds: ['spring-clock', 'spring-crossing'],
    resources: [{ title: 'OpenStax: Simple Harmonic Motion', url: 'https://openstax.org/books/university-physics-volume-1/pages/15-1-simple-harmonic-motion' }],
  },
  {
    id: 'probability', subject: 'math', phase: 6, title: 'Probability, mean, and spread', frenchTitle: 'Probabilités, moyenne et variance',
    summary: 'Turn possible microstates into a predicted average and uncertainty.',
    primer: String.raw`Probability describes possible outcomes and how often they occur over repeated trials. For a discrete random variable $X$, list values $x_i$ and probabilities $p_i$. Each probability must lie between zero and one, and $\sum_i p_i=1$. The expectation $\mu=E[X]=\sum_i p_i x_i$ is a weighted average, sometimes called the espérance.

For example, a reward is $1$ point with probability $1/2$ or $3$ points with probability $1/2$. Its mean is $2$ points, although neither single-trial outcome is $2$. Squaring before averaging gives $E[X^2]=(1^2+3^2)/2=5$ points squared.

Variance measures spread around the mean:
$$\operatorname{Var}(X)=\sum_i p_i(x_i-\mu)^2=E[X^2]-\mu^2.$$
In the example it is $5-4=1$ point squared. The standard deviation is the square root of variance, here $1$ point, so it has the same units as the outcomes.

For independent trials, joint probabilities multiply; remember every ordered way an event can occur. Means of sums always add, while variances add for independent variables. Check that variance is nonnegative, and distinguish the average of squared outcomes from the square of their average.`,
    objectives: ['Compute expectation and variance', 'Enumerate two independent trials'],
    prerequisites: ['functions'], exerciseIds: ['two-level-mean', 'two-trial-count'],
    resources: [{ title: 'OpenStax: Mean or Expected Value and Standard Deviation', url: 'https://openstax.org/books/introductory-statistics-2e/pages/4-2-mean-or-expected-value-and-standard-deviation' }],
  },
  {
    id: 'thermal-models', subject: 'physics', phase: 6, title: 'Microscopic averages and thermal models', frenchTitle: 'Moyennes microscopiques et modèles thermiques',
    summary: 'Use a distribution of states to predict kinetic or internal energy.',
    primer: String.raw`A thermal model links many microscopic states to a measurable total. Individual particles may have different speeds or energies even when the collection has a stable average. Probability-weighted averages let us predict that aggregate without tracking every particle's trajectory.

For one particle of mass $m$, kinetic energy is $K=mv^2/2$. Because energy depends on squared speed, $E[K]=mE[v^2]/2$. For example, if speeds $0$ and $4$ m/s are equally likely, $E[v]=2$ m/s but $E[v^2]=8$ m$^2$/s$^2$. A particle of mass $0.001$ kg then has mean kinetic energy $0.004$ J. Using the squared mean speed would give only half that value. The root-mean-square speed is $v_{\rm rms}=\sqrt{E[v^2]}$.

A second toy model gives each of $N$ independent particles energy $0$ or $\epsilon$, with excitation probability $p$. For their total energy $U$,
$$E[U]=Np\epsilon,\qquad \operatorname{Var}(U)=Np(1-p)\epsilon^2.$$
Thus $N=50$ and $p=0.1$ give mean $5\epsilon$ and standard deviation $\sqrt{4.5}\epsilon$.

Check units: energy means and standard deviations are in joules, variances in joules squared. Independence is needed for this variance formula. These deliberately simple distributions build intuition; they do not assert that a real gas has only two speeds or energy levels.`,
    objectives: ['Compute average kinetic energy from speed probabilities', 'Predict the mean and spread of a many-particle energy'],
    prerequisites: ['probability', 'work-energy'], exerciseIds: ['gas-speed-sample', 'two-level-ensemble'],
    resources: [
      { title: 'OpenStax: Molecular Model of an Ideal Gas', url: 'https://openstax.org/books/university-physics-volume-2/pages/2-1-molecular-model-of-an-ideal-gas' },
      { title: 'OpenStax: Pressure, Temperature, and RMS Speed', url: 'https://openstax.org/books/university-physics-volume-2/pages/2-2-pressure-temperature-and-rms-speed' },
    ],
  },
];

const rubric = (a: string, b: string, c: string): Exercise['rubric'] => [
  { criterion: a, points: 3 }, { criterion: b, points: 4 }, { criterion: c, points: 3 },
];

export const exercises: Exercise[] = [
  {
    id: 'sensor-calibration', moduleId: 'functions', title: 'Calibrate a light sensor', difficulty: 'warmup', minutes: 10,
    prompt: String.raw`A light sensor reports $2$ V in darkness ($L=0$) and $5$ V at $L=6$ arbitrary light units. Assume $V(L)=aL+b$. Find $a$ and $b$, predict $V(4)$, and find the light level that gives $4$ V.`,
    starter: 'Write the two data points as equations for a and b.', skills: ['linear functions', 'algebra', 'units'],
    hints: ['At zero light, the model immediately gives the intercept.', 'Use the difference in voltage divided by the difference in light level for the slope.', 'Once you have the rule, substitute $L=4$; then set the rule equal to $4$ V and solve.'],
    solution: String.raw`At $L=0$, $b=2$ V. The slope is $a=(5-2)/(6-0)=0.5$ V per light unit, so $V(L)=0.5L+2$. Thus $V(4)=0.5(4)+2=4$ V. Setting $0.5L+2=4$ gives $L=4$. Checks: the rule gives $2$ V at $L=0$ and $5$ V at $L=6$.`,
    answer: '$a=0.5$ V/light unit, $b=2$ V; $V(4)=4$ V and $L=4$.',
    rubric: rubric('Uses the two measurements to identify slope and intercept', 'Builds the correct linear model and evaluates it at L=4', 'Solves the inverse question and checks units'),
  },
  {
    id: 'lamp-arc', moduleId: 'functions', title: 'When does the beam meet the floor?', difficulty: 'practice', minutes: 15,
    prompt: String.raw`A stylized beam height is $h(t)=6+5t-t^2$ metres for $t\ge0$ seconds. Find the height at $t=2$, the time when it returns to $6$ m, and the later time when it reaches the floor.`,
    starter: 'Substitute t=2, then solve two separate quadratic equations.', skills: ['quadratics', 'domain checks'],
    hints: ['Evaluate the polynomial directly for the first part.', 'For $h=6$, factor $5t-t^2$.', 'For $h=0$, factor $t^2-5t-6$ and reject a negative time.'],
    solution: String.raw`$h(2)=6+10-4=12$ m. Setting $h=6$ gives $t(5-t)=0$, so the return after launch is $t=5$ s. Setting $h=0$ gives $t^2-5t-6=(t-6)(t+1)=0$. Only $t=6$ s lies in $t\ge0$. Substitution gives $h(6)=6+30-36=0$.`,
    answer: '$h(2)=12$ m; returns to $6$ m at $5$ s; reaches floor at $6$ s.',
    rubric: rubric('Evaluates the model at t=2', 'Solves the two equations correctly', 'Selects physically valid times and checks the floor result'),
  },
  {
    id: 'drone-scale', moduleId: 'units-vectors', title: 'A drone’s distance law', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`A drone starting from rest follows $d=ct^2$. It travels $18$ m in $3$ s. Find $c$ with units, predict its distance at $5$ s, and explain why $c$ cannot have units m/s.`,
    starter: 'Rearrange the distance law for c before inserting numbers.', skills: ['dimensional analysis', 'scaling'],
    hints: ['Rearrange the distance law to $c=d/t^2$.', 'The exponent applies to the time unit too.', 'At $5$ s, use the same $c$; compare the units on each side of $d=ct^2$.'],
    solution: String.raw`$c=18/3^2=2$ m/s$^2$. Therefore $d(5)=2(5)^2=50$ m. Since $[d]=L$ and $[t^2]=T^2$, $[c]=L/T^2$. If $c$ had units m/s, $ct^2$ would have units m s, not metres.`,
    answer: '$c=2$ m/s$^2$ and $d(5)=50$ m.',
    rubric: rubric('Rearranges the law', 'Computes both values with correct units', 'Explains the dimensional check'),
  },
  {
    id: 'field-walk', moduleId: 'units-vectors', title: 'A surveyor’s walk', difficulty: 'practice', minutes: 15,
    prompt: String.raw`A surveyor walks $30$ m east, $40$ m north, then $30$ m west. Give the final displacement vector, its magnitude, and the total path length. Explain why the last two numbers differ.`,
    starter: 'Take east as +x and north as +y.', skills: ['vector components', 'displacement'],
    hints: ['Write each leg as a pair of components.', 'Add the x entries and the y entries separately.', 'Displacement depends on endpoints; path length adds every leg.'],
    solution: String.raw`The legs are $(30,0)$, $(0,40)$, and $(-30,0)$ m. Their sum is $(0,40)$ m, so the displacement magnitude is $\sqrt{0^2+40^2}=40$ m north. The walked path is $30+40+30=100$ m. East and west cancel in displacement but both add to path length.`,
    answer: 'Displacement $(0,40)$ m, magnitude $40$ m north; path length $100$ m.',
    rubric: rubric('Chooses axes and component vectors', 'Adds components and computes displacement magnitude', 'Computes path length and explains the distinction'),
  },
  {
    id: 'track-tangent', moduleId: 'derivatives', title: 'A tangent from first principles', difficulty: 'warmup', minutes: 15,
    prompt: String.raw`A marker follows $x(t)=2t^2+3t$ metres. Use $[x(t+h)-x(t)]/h$ to find $x'(t)$, then give the rate at $t=2$ s with units.`,
    starter: 'Expand x(t+h) carefully before dividing by h.', skills: ['derivative definition', 'polynomial rates'],
    hints: ['$(t+h)^2=t^2+2th+h^2$.', 'After subtraction, every remaining term contains $h$.', String.raw`Cancel $h$, let $h\to0$, and substitute $t=2$.`],
    solution: String.raw`$x(t+h)=2t^2+4th+2h^2+3t+3h$, so $[x(t+h)-x(t)]/h=(4th+2h^2+3h)/h=4t+2h+3$. Letting $h\to0$ gives $x'(t)=4t+3$ m/s. At $t=2$ s the rate is $11$ m/s.`,
    answer: "$x'(t)=4t+3$ m/s; $x'(2)=11$ m/s.",
    rubric: rubric('Expands the increment correctly', 'Forms and takes the limit of the quotient', 'Evaluates the rate with units'),
  },
  {
    id: 'signal-peaks', moduleId: 'derivatives', title: 'Find the turning levels', difficulty: 'stretch', minutes: 18,
    prompt: String.raw`A dimensionless signal is $s(t)=t^3-6t^2+9t$ for $0\le t\le4$. Find its interior stationary times, classify each as a local maximum or minimum, and give the signal values there.`,
    starter: 'Differentiate and factor the quadratic derivative.', skills: ['polynomial differentiation', 'stationary points'],
    hints: ["Compute $s'(t)=3t^2-12t+9$.", 'Factor out $3$ and find the two roots.', "Check the sign of $s'$ on the intervals around each root, then evaluate $s$."],
    solution: String.raw`$s'(t)=3(t-1)(t-3)$, so the stationary times are $1$ and $3$. The derivative is positive before $1$, negative between $1$ and $3$, and positive after $3$. Thus $t=1$ is a local maximum and $t=3$ a local minimum. $s(1)=1-6+9=4$; $s(3)=27-54+27=0$. Both lie inside the given time interval.`,
    answer: 'Local maximum $s(1)=4$; local minimum $s(3)=0$.',
    rubric: rubric('Differentiates and factors', 'Finds and classifies both stationary times', 'Evaluates values and respects the domain'),
  },
  {
    id: 'cart-speed', moduleId: 'kinematics', title: 'Read a cart’s motion', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`A cart has position $x(t)=3t+2t^2$ metres for $t\ge0$ seconds. Find $v(t)$ and $a(t)$, then state its velocity and acceleration at $t=2$ s.`,
    starter: 'Differentiate position once for velocity, then again for acceleration.', skills: ['velocity', 'acceleration', 'units'],
    hints: ['The derivative of $3t$ is $3$.', 'The derivative of $2t^2$ is $4t$.', 'Differentiate $v$ again and attach m/s or m/s$^2$ as appropriate.'],
    solution: String.raw`$v(t)=dx/dt=3+4t$ m/s. Differentiating again gives $a(t)=4$ m/s$^2$. At $t=2$ s, $v=3+8=11$ m/s and $a=4$ m/s$^2$. The positive velocity and acceleration indicate increasing speed in the chosen positive direction.`,
    answer: '$v(t)=3+4t$ m/s, $a(t)=4$ m/s$^2$; at $2$ s: $11$ m/s and $4$ m/s$^2$.',
    rubric: rubric('Connects position, velocity, and acceleration', 'Differentiates both times correctly', 'Evaluates and interprets values with units'),
  },
  {
    id: 'braking-cart', moduleId: 'kinematics', title: 'Find the stopping point', difficulty: 'practice', minutes: 15,
    prompt: String.raw`A cart brakes along a straight track. Its position is $x(t)=12t-1.5t^2$ metres for $0\le t\le4$ seconds. When does it stop, how far from its starting point is it then, and what is its acceleration?`,
    starter: 'A stop occurs when instantaneous velocity becomes zero.', skills: ['kinematics', 'derivatives', 'domain checks'],
    hints: ['Differentiate the position polynomial.', 'Solve $12-3t=0$ and check the time interval.', 'Substitute that time into $x(t)$ and differentiate once more for acceleration.'],
    solution: String.raw`$v(t)=12-3t$ m/s, so $v=0$ at $t=4$ s, the endpoint of the model interval. $x(4)=12(4)-1.5(16)=48-24=24$ m, while $x(0)=0$. The stopping distance is $24$ m. $a(t)=dv/dt=-3$ m/s$^2$. The velocity stays nonnegative on $[0,4]$, so this is also the distance traveled.`,
    answer: 'Stops at $4$ s, $24$ m from start; acceleration $-3$ m/s$^2$.',
    rubric: rubric('Finds velocity and stopping condition', 'Computes stopping distance correctly', 'Gives acceleration, units, and domain interpretation'),
  },
  {
    id: 'conveyor-total', moduleId: 'integrals', title: 'Accumulate conveyor travel', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`A conveyor moves with velocity $v(t)=2+3t$ m/s for $0\le t\le4$ s. Use an integral to find its displacement. Why is that also its distance traveled?`,
    starter: 'Find an antiderivative of each term of v(t).', skills: ['definite integrals', 'displacement'],
    hints: ['Integrate from $0$ to $4$.', String.raw`An antiderivative is $2t+\tfrac32t^2$.`, 'Check the sign of $v(t)$ on the interval.'],
    solution: String.raw`$\Delta x=\int_0^4(2+3t)\,dt=[2t+\tfrac32t^2]_0^4=8+24=32$ m. Since $2+3t>0$ throughout $[0,4]$, the conveyor never reverses, so distance traveled equals the signed displacement, $32$ m.`,
    answer: '$32$ m displacement and $32$ m distance.',
    rubric: rubric('Sets up the definite integral with limits', 'Evaluates the antiderivative and units', 'Explains why distance equals displacement here'),
  },
  {
    id: 'out-and-back', moduleId: 'integrals', title: 'Displacement versus distance', difficulty: 'practice', minutes: 15,
    prompt: String.raw`A small rover has $v(t)=t-2$ m/s for $0\le t\le4$ s. Find its signed displacement and total distance traveled, using integrals and showing where you split the interval.`,
    starter: 'Locate where velocity changes sign.', skills: ['signed area', 'absolute value', 'integrals'],
    hints: ['Set $v(t)=0$ to find the reversal at $t=2$.', 'For displacement integrate $v$ over the whole interval.', 'For distance integrate $-v$ on $[0,2]$ and $v$ on $[2,4]$.'],
    solution: String.raw`An antiderivative is $t^2/2-2t$. Thus $\Delta x=[t^2/2-2t]_0^4=0$ m. Velocity is negative before $2$ s and positive afterward. Distance is $\int_0^2(2-t)\,dt+\int_2^4(t-2)\,dt=[2t-t^2/2]_0^2+[t^2/2-2t]_2^4=2+2=4$ m.`,
    answer: 'Displacement $0$ m; distance $4$ m.',
    rubric: rubric('Finds the sign-change time', 'Computes signed displacement', 'Splits and evaluates the absolute-velocity integral'),
  },
  {
    id: 'stretch-spring', moduleId: 'work-energy', title: 'Work to stretch a spring', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`A spring needs applied force $F(x)=6x$ N when stretched $x$ metres from equilibrium. How much work must an external agent do to stretch it slowly from $x=0$ to $x=0.5$ m?`,
    starter: 'Work is the area under force versus position.', skills: ['work integral', 'spring energy'],
    hints: [String.raw`Write $W=\int_0^{0.5}6x\,dx$.`, 'An antiderivative is $3x^2$.', 'The spring force itself points opposite the stretch; identify whose work you calculate.'],
    solution: String.raw`For a slow stretch, the external applied force is $+6x$ N. Its work is $W_{\rm ext}=\int_0^{0.5}6x\,dx=[3x^2]_0^{0.5}=3(0.25)=0.75$ J. The spring does $-0.75$ J of work, and its stored potential energy rises by $0.75$ J.`,
    answer: 'External work $0.75$ J; spring work $-0.75$ J.',
    rubric: rubric('Chooses the correct force and limits', 'Integrates and computes 0.75 J', 'Distinguishes applied work from spring work'),
  },
  {
    id: 'rough-ramp', moduleId: 'work-energy', title: 'Speed after a rough descent', difficulty: 'practice', minutes: 15,
    prompt: String.raw`A $2$ kg cart starts from rest and descends $1.5$ m vertically. Take $g=10$ m/s$^2$. Friction does $-5$ J of work. Find its speed at the bottom and state the energy balance.`,
    starter: 'Gravity adds energy; friction removes some.', skills: ['energy balance', 'kinetic energy'],
    hints: ['Compute the gravitational energy drop $mgh$.', 'Set $K_f-K_i=W_g+W_f$.', 'Use $K_f=mv^2/2$ and take the nonnegative speed.'],
    solution: String.raw`Gravity does $W_g=mgh=2(10)(1.5)=30$ J; friction does $W_f=-5$ J. From rest, $K_i=0$, so $K_f=30-5=25$ J. Since $K_f=\tfrac12(2)v^2=v^2$ in joules, $v^2=25$ m$^2$/s$^2$ and the speed is $5$ m/s. The positive root is the speed magnitude.`,
    answer: '$K_f=30-5=25$ J and $v=5$ m/s.',
    rubric: rubric('Computes gravitational and friction work with signs', 'Sets up the energy balance', 'Solves for speed with units'),
  },
  {
    id: 'two-sensors', moduleId: 'linear-systems', title: 'Separate two signals', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`Two sensors measure a mixture of signals $x$ and $y$. Their readings satisfy $2x+y=5$ and $x+3y=5$. Solve for $x,y$ and check both readings.`,
    starter: 'Express y from the first equation and substitute into the second.', skills: ['linear systems', 'substitution'],
    hints: ['Rearrange the first equation as $y=5-2x$.', 'Substitute to get $x+3(5-2x)=5$.', 'Solve for $x$, recover $y$, and test both equations.'],
    solution: String.raw`From the first reading, $y=5-2x$. The second gives $x+3(5-2x)=5$, hence $-5x=-10$ and $x=2$. Then $y=5-4=1$. Checks: $2(2)+1=5$ and $2+3(1)=5$.`,
    answer: '$x=2$, $y=1$.',
    rubric: rubric('Sets up elimination or substitution', 'Solves both unknowns', 'Checks both original equations'),
  },
  {
    id: 'matrix-check', moduleId: 'linear-systems', title: 'A matrix consistency check', difficulty: 'practice', minutes: 15,
    prompt: String.raw`Let $A=\begin{pmatrix}2&1\\1&3\end{pmatrix}$ and $\mathbf{u}=\begin{pmatrix}2\\1\end{pmatrix}$. Compute $A\mathbf{u}$ and $\det A$. What does the determinant tell you about solving $A\mathbf{x}=A\mathbf{u}$?`,
    starter: 'Multiply each row of A by the column vector.', skills: ['matrix multiplication', 'determinant'],
    hints: ['The first output entry is $2(2)+1(1)$.', String.raw`For a $2\times2$ matrix, use $ad-bc$.`, 'A nonzero determinant means the matrix has an inverse.'],
    solution: String.raw`Row products give $A\mathbf{u}=\begin{pmatrix}5\\5\end{pmatrix}$. The determinant is $2(3)-1(1)=5\ne0$. Thus $A$ is invertible, and $A\mathbf{x}=A\mathbf{u}$ has exactly one solution, namely $\mathbf{x}=\mathbf{u}=(2,1)^T$. Direct checking gives the same two equations as the preceding exercise.`,
    answer: String.raw`$A\mathbf{u}=(5,5)^T$, $\det A=5$; unique solution $\mathbf{x}=(2,1)^T$.`,
    rubric: rubric('Multiplies rows by the vector', 'Computes the determinant', 'Interprets nonzero determinant and identifies the unique solution'),
  },
  {
    id: 'parallel-branches', moduleId: 'circuits', title: 'Current at a junction', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`A $6$ V ideal source feeds two parallel resistors, $6\,\Omega$ and $3\,\Omega$. Find each branch current and the total source current. State the junction rule used.`,
    starter: 'Each parallel branch has the same 6 V across it.', skills: ['Ohm law', 'junction rule'],
    hints: ['Use $I=V/R$ for each resistor.', 'Add currents at the junction.', 'Check that branch currents have units amperes.'],
    solution: String.raw`The $6\,\Omega$ branch carries $I_1=6/6=1$ A and the $3\,\Omega$ branch carries $I_2=6/3=2$ A. Charge conservation at the split gives $I_{\rm source}=I_1+I_2=3$ A. Both branches have the full source voltage because they share the same two nodes.`,
    answer: '$I_1=1$ A, $I_2=2$ A, source current $3$ A.',
    rubric: rubric('Recognizes equal voltage across parallel branches', 'Computes both currents', 'Applies the junction rule with units'),
  },
  {
    id: 'coupled-loops', moduleId: 'circuits', title: 'Two coupled mesh currents', difficulty: 'stretch', minutes: 20,
    prompt: String.raw`Two clockwise meshes share a $1\,\Omega$ resistor. The left mesh also has a $2\,\Omega$ resistor and a $5$ V source; the right has a $3\,\Omega$ resistor and a $5$ V source. The sources drive their chosen clockwise mesh directions. Write the two loop equations, solve for clockwise mesh currents $I_1,I_2$, and find the current through the shared resistor measured in the left-mesh direction.`,
    starter: 'The shared branch current in the left direction is I1−I2.', skills: ['Kirchhoff loops', 'linear systems'],
    hints: ['Left loop: $2I_1+1(I_1-I_2)=5$.', 'Right loop: $3I_2+1(I_2-I_1)=5$.', 'Solve $3I_1-I_2=5$ and $-I_1+4I_2=5$, then subtract the currents.'],
    solution: String.raw`The loop equations are $2I_1+(I_1-I_2)=5$ and $3I_2+(I_2-I_1)=5$, with ohms times amperes yielding volts. Thus $3I_1-I_2=5$ and $-I_1+4I_2=5$. Substituting $I_2=3I_1-5$ gives $11I_1=25$, so $I_1=25/11$ A and $I_2=20/11$ A. The shared current is $I_1-I_2=5/11$ A in the left-mesh direction. Check: $3(25/11)-20/11=5$ V and $-25/11+4(20/11)=5$ V.`,
    answer: '$I_1=25/11$ A, $I_2=20/11$ A, shared current $5/11$ A in the left-mesh direction.',
    rubric: rubric('Writes both signed loop equations', 'Solves the coupled system', 'Computes and checks the shared current'),
  },
  {
    id: 'cooling-law', moduleId: 'differential-equations', title: 'A decaying temperature difference', difficulty: 'warmup', minutes: 15,
    prompt: String.raw`A temperature difference $y(t)$ in °C obeys $y'=-0.5y$ per minute, with $y(0)=8$ °C. Propose $y(t)$, verify it satisfies the equation and initial value, and find $y(2)$ exactly.`,
    starter: 'Try an exponential with exponent −0.5t.', skills: ['differential equations', 'exponentials'],
    hints: ['Use the initial value as the coefficient of the exponential.', 'Differentiate your proposed function and compare it with $-0.5y$.', 'For $t=2$, the exponent becomes $-1$.'],
    solution: String.raw`Try $y(t)=8e^{-0.5t}$ °C, where $0.5$ has units min$^{-1}$. Then $y'(t)=-4e^{-0.5t}$ °C/min, which equals $-0.5y(t)$. Also $y(0)=8$. At $t=2$ min, $y(2)=8e^{-1}$ °C, about $2.94$ °C. The difference stays positive and decreases as expected.`,
    answer: String.raw`$y(t)=8e^{-0.5t}$ °C; $y(2)=8/e\approx2.94$ °C.`,
    rubric: rubric('Proposes the exponential with the initial value', 'Verifies the differential equation and units', 'Evaluates the two-minute result'),
  },
  {
    id: 'euler-decay', moduleId: 'differential-equations', title: 'Two Euler steps', difficulty: 'practice', minutes: 15,
    prompt: String.raw`For $y'=-y$ with $y(0)=1$, use Euler's method with step $h=0.25$ to estimate $y(0.5)$. Compare with exact $e^{-0.5}$; is the estimate high or low?`,
    starter: 'Each step is new y = old y + h(−old y).', skills: ['Euler method', 'approximation error'],
    hints: ['Write the recurrence $y_{n+1}=0.75y_n$.', 'Start at $y_0=1$ and take exactly two steps.', String.raw`Compare $0.75^2$ with $e^{-0.5}\approx0.6065$.`],
    solution: String.raw`Euler gives $y_{n+1}=y_n+0.25(-y_n)=0.75y_n$. Thus $y_1=0.75$ at $t=0.25$ and $y_2=0.5625$ at $t=0.5$. The exact solution is $e^{-t}$, so $y(0.5)=e^{-0.5}\approx0.60653$. The estimate is low by about $0.04403$.`,
    answer: 'Euler estimate $0.5625$; exact value about $0.60653$; estimate is low.',
    rubric: rubric('Sets up Euler recurrence', 'Takes two correct steps', 'Compares with exact solution and states error direction'),
  },
  {
    id: 'spring-clock', moduleId: 'oscillators', title: 'A spring as a clock', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`An ideal $1$ kg mass is attached to a spring with $k=4$ N/m. Its amplitude is $0.10$ m. Find angular frequency $\omega$, period $T$, and maximum speed.`,
    starter: 'Use omega = square root of k/m.', skills: ['harmonic motion', 'period', 'velocity amplitude'],
    hints: [String.raw`Start with $\omega=\sqrt{k/m}$.`, String.raw`Use the angular frequency in $T=2\pi/\omega$.`, String.raw`For $x=A\cos(\omega t)$, the speed amplitude is $A\omega$.`],
    solution: String.raw`$\omega=\sqrt{4/1}=2$ rad/s. The period is $T=2\pi/2=\pi$ s. Differentiating $x=A\cos(\omega t)$ gives $v=-A\omega\sin(\omega t)$, so $v_{\max}=A\omega=0.10(2)=0.20$ m/s. The radians in angular frequency are dimensionless.`,
    answer: String.raw`$\omega=2$ rad/s, $T=\pi$ s, $v_{\max}=0.20$ m/s.`,
    rubric: rubric('Finds angular frequency', 'Finds period with units', 'Derives and computes maximum speed'),
  },
  {
    id: 'spring-crossing', moduleId: 'oscillators', title: 'Energy at equilibrium crossing', difficulty: 'practice', minutes: 18,
    prompt: String.raw`An ideal $1$ kg oscillator has $x(t)=0.05\cos(4t)$ m. Find $k$, its total mechanical energy, and its speed and energy split at $t=\pi/8$ s.`,
    starter: 'Compare x double prime with −(k/m)x.', skills: ['oscillator equation', 'energy conservation'],
    hints: [String.raw`$x''=-16x$, so $k/m=16$ s$^{-2}$.`, 'The total energy is $kA^2/2$.', String.raw`At $t=\pi/8$, $4t=\pi/2$; differentiate x to find velocity.`],
    solution: String.raw`Because $x''=-16x$, $k=m(16)=16$ N/m. With $A=0.05$ m, $E=\tfrac12kA^2=\tfrac12(16)(0.05)^2=0.020$ J. At $t=\pi/8$, $x=0$ and $v=-0.05(4)\sin(\pi/2)=-0.20$ m/s, so speed is $0.20$ m/s. Spring potential energy is zero and kinetic energy is $\tfrac12(1)(0.20)^2=0.020$ J, matching the total.`,
    answer: String.raw`$k=16$ N/m, $E=0.020$ J; at $\pi/8$ s speed $0.20$ m/s, $K=0.020$ J, $U=0$.`,
    rubric: rubric('Uses the equation of motion to find k', 'Computes total energy', 'Finds the crossing speed and verifies energy split'),
  },
  {
    id: 'two-level-mean', moduleId: 'probability', title: 'One two-level system', difficulty: 'warmup', minutes: 12,
    prompt: String.raw`A tiny system has energy $X=0$ units with probability $3/4$ and $X=2$ units with probability $1/4$. Find $E[X]$, $E[X^2]$, and $\operatorname{Var}(X)$.`,
    starter: 'Multiply each possible value by its probability and add.', skills: ['expectation', 'variance'],
    hints: ['First check that the two probabilities add to one.', 'For $E[X^2]$, square the energy before weighting.', String.raw`Use $\operatorname{Var}(X)=E[X^2]-E[X]^2$.`],
    solution: String.raw`The probabilities sum to $1$. $E[X]=0(3/4)+2(1/4)=1/2$ energy unit. $E[X^2]=0^2(3/4)+2^2(1/4)=1$ energy unit squared. Therefore $\operatorname{Var}(X)=1-(1/2)^2=3/4$ energy unit squared. The mean $1/2$ is an average, not a possible outcome in a single trial.`,
    answer: String.raw`$E[X]=1/2$, $E[X^2]=1$, $\operatorname{Var}(X)=3/4$.`,
    rubric: rubric('Checks and uses the probability distribution', 'Computes both expectations', 'Computes and interprets variance'),
  },
  {
    id: 'two-trial-count', moduleId: 'probability', title: 'Count two independent excitations', difficulty: 'practice', minutes: 17,
    prompt: String.raw`Two independent units are each excited with probability $1/4$. Let $N$ be the number excited. List $P(N=0),P(N=1),P(N=2)$, then find $E[N]$ and $\operatorname{Var}(N)$.`,
    starter: 'There are four ordered yes/no patterns.', skills: ['independent events', 'binomial count', 'variance'],
    hints: ['$P(N=0)=(3/4)^2$ and $P(N=2)=(1/4)^2$.', 'Exactly one excitation has two ordered ways.', 'Use the distribution for $E[N]$ and $E[N^2]$, then subtract the squared mean.'],
    solution: String.raw`Independence gives $P(N=0)=9/16$, $P(N=1)=2(1/4)(3/4)=6/16$, and $P(N=2)=1/16$; they sum to $1$. $E[N]=0+6/16+2/16=8/16=1/2$. $E[N^2]=6/16+4/16=10/16=5/8$, so $\operatorname{Var}(N)=5/8-(1/2)^2=3/8$.`,
    answer: 'Probabilities $9/16,6/16,1/16$; mean $1/2$; variance $3/8$.',
    rubric: rubric('Enumerates the count distribution', 'Computes the mean', 'Computes variance and checks normalization'),
  },
  {
    id: 'gas-speed-sample', moduleId: 'thermal-models', title: 'Why mean-square speed matters', difficulty: 'warmup', minutes: 15,
    prompt: String.raw`In a toy one-dimensional particle sample, a particle of mass $0.002$ kg has speed $1$, $2$, or $3$ m/s with probabilities $1/4$, $1/2$, $1/4$. Find $E[v]$, $E[v^2]$, the root-mean-square speed, and its mean kinetic energy.`,
    starter: 'Compute the mean of v² separately from the mean of v.', skills: ['weighted averages', 'rms speed', 'kinetic energy'],
    hints: ['$E[v]=1(1/4)+2(1/2)+3(1/4)$.', '$E[v^2]=1^2(1/4)+2^2(1/2)+3^2(1/4)$.', String.raw`Use $v_{\rm rms}=\sqrt{E[v^2]}$ and $E[K]=mE[v^2]/2$.`],
    solution: String.raw`$E[v]=0.25+1+0.75=2$ m/s. $E[v^2]=0.25+2+2.25=4.5$ m$^2$/s$^2$, so $v_{\rm rms}=\sqrt{4.5}\approx2.121$ m/s. Mean kinetic energy is $E[K]=\tfrac12(0.002)(4.5)=0.0045$ J. Using $E[v]^2=4$ instead would underestimate it, because squaring and averaging do not commute.`,
    answer: String.raw`$E[v]=2$ m/s, $E[v^2]=4.5$ m$^2$/s$^2$, $v_{\rm rms}\approx2.121$ m/s, $E[K]=0.0045$ J.`,
    rubric: rubric('Computes mean and mean square separately', 'Finds rms speed', 'Finds mean kinetic energy with correct units and distinction'),
  },
  {
    id: 'two-level-ensemble', moduleId: 'thermal-models', title: 'Energy of an ensemble', difficulty: 'stretch', minutes: 18,
    prompt: String.raw`A toy collection has $100$ independent particles. Each has energy $0$ with probability $0.8$ or $\epsilon=2\times10^{-21}$ J with probability $0.2$. Find the expected total energy, its variance, and its standard deviation. Explain whether the expected energy must occur in one observation.`,
    starter: 'First find the mean and variance for one particle; independent variances add.', skills: ['ensemble mean', 'variance', 'independence'],
    hints: [String.raw`For one particle, $E[X]=p\epsilon$ and $E[X^2]=p\epsilon^2$.`, String.raw`Its variance is $p(1-p)\epsilon^2$.`, 'Multiply mean and variance by $100$, then take a square root for standard deviation.'],
    solution: String.raw`For one particle, $E[X]=0.2\epsilon$ and $\operatorname{Var}(X)=0.2(0.8)\epsilon^2=0.16\epsilon^2$. For $100$ independent particles, $E[U]=100(0.2)\epsilon=20\epsilon=4\times10^{-20}$ J. The variance is $100(0.16)\epsilon^2=16\epsilon^2=6.4\times10^{-41}$ J$^2$. Standard deviation is $4\epsilon=8\times10^{-21}$ J. This expected energy happens to equal the energy of exactly $20$ excited particles, so it **can** occur, but a single observation is not guaranteed to have $20$ excitations.`,
    answer: String.raw`$E[U]=4\times10^{-20}$ J; $\operatorname{Var}(U)=6.4\times10^{-41}$ J$^2$; $\sigma_U=8\times10^{-21}$ J.`,
    rubric: rubric('Finds one-particle mean and variance', 'Scales both to 100 independent particles', 'Computes standard deviation and interprets an observation'),
  },
];

// Warmups sample algebra, physical scaling, a derivative, and mechanics.
export const diagnosticIds: string[] = ['sensor-calibration', 'drone-scale', 'track-tangent', 'braking-cart'];
