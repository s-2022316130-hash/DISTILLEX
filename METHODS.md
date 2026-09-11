# DISTILLEX — Methods

What the simulator computes, how each quantity is derived, and where the model
stops. Every equation below is the one the code actually evaluates; the file is
kept honest by `tools/test.js`, whose `disclosures` suite re-reads the numeric
claims out of the source and fails if they drift.

**On references.** This document derives each relation from first principles. It
deliberately contains no literature citations and no comparison against
published worked examples, because no such comparison has been carried out. The
validation that *has* been performed is described in
[Validation](#8-validation--what-is-and-is-not-checked) and is entirely
self-contained. Do not read this file as evidence of external verification.

## Nomenclature

| Symbol | Meaning | Unit |
| --- | --- | --- |
| `A`, `B` | the more- and less-volatile component of the binary | — |
| `x`, `y` | liquid / vapour mole fraction of the light key | mol/mol |
| `z_F`, `x_D`, `x_B` | feed, distillate, bottoms composition | mol/mol |
| `F`, `D`, `B` | feed, distillate, bottoms molar flow | kmol/h |
| `L`, `V` | rectifying liquid / vapour traffic | kmol/h |
| `L̄`, `V̄` | stripping liquid / vapour traffic | kmol/h |
| `R` | reflux ratio `L/D` | — |
| `q` | feed quality (saturated liquid added to the stripping section per mole of feed) | — |
| `P` | column pressure | kPa |
| `Pᵢˢᵃᵗ` | saturation vapour pressure of component *i* | kPa |
| `α` | relative volatility of A with respect to B | — |
| `N`, `N_min` | theoretical stages (reboiler included), minimum at total reflux | — |
| `E_o` | overall tray efficiency | — |
| `λ` | molar latent heat of vaporisation | kJ/mol |
| `Q_C`, `Q_R` | condenser / reboiler duty | MW |

## 1. Vapour pressure — the Antoine equation

    log₁₀ Pˢᵃᵗ[mmHg] = A − B / (T[°C] + C)

Implemented in `psat(c,T)`, which converts to kPa with the exact factor
`1 mmHg = 0.13332239 kPa`. The three constants are stored per component in
`static COMP` together with the temperature window each set was fitted over.

The form follows from integrating the Clausius–Clapeyron relation
`d ln Pˢᵃᵗ/dT = Δh_vap /(R T²)` and replacing the absolute temperature in the
denominator with the empirical offset `T + C`, which absorbs the temperature
dependence of `Δh_vap` over a limited range. It is therefore a correlation, not
a thermodynamic identity, and it is only meaningful inside its fitted window.

Two consequences the code acts on:

* The correlation has a **pole at `T = −C`**. The bubble- and dew-point solvers
  bisect over −80…500 °C, so a user-supplied `C` must exceed 80 for `T + C` to
  stay positive across that whole interval. This is enforced as a model-domain
  rule (`ANTOINE_C_MIN`), derived from the solver bracket rather than from any
  published validity range. Every built-in component satisfies it comfortably
  (the smallest is n-heptane at 216.636).
* `B > 0` is required, otherwise vapour pressure would fall as temperature rises.

Stage temperatures more than 10 °C outside a component's fitted window raise an
explicit extrapolation warning rather than silently degrading.

## 2. Vapour–liquid equilibrium

### Ideal (Raoult) model

For an ideal liquid solution and an ideal-gas vapour, the partial pressure of a
component is its mole fraction times its pure-component vapour pressure, and the
partial pressures sum to the total:

    yᵢ P = xᵢ Pᵢˢᵃᵗ(T)            Σ xᵢ Pᵢˢᵃᵗ(T) = P

For a binary this gives, at the bubble temperature of that liquid,

    y = x Pᴬˢᵃᵗ(T) / P

### Constant relative volatility

    α = (y_A/x_A)/(y_B/x_B)      ⇒   y = αx / (1 + (α−1)x)

Under Raoult's law `α = Pᴬˢᵃᵗ/Pᴮˢᵃᵗ`, a weak function of temperature. The
constant-α option holds `α` fixed at a user value and requires `α > 1`: at
`α = 1` the equilibrium curve collapses onto the diagonal and no separation is
possible, and `α < 1` means the components are labelled the wrong way round.

**A known inconsistency:** in constant-α mode the composition relation uses the
fixed `α`, but stage temperatures are still the Raoult bubble points of the
stored Antoine data — they do not depend on `α` at all. The T–x–y plot and the
reported top/bottom temperatures therefore do not correspond to the `y(x)` used
for the stages. This is a deliberate simplification, not an oversight.

The size of the mismatch is measurable: `max |T_dew(y*(x)) − T_bubble(x)|` over
the composition range, for benzene/toluene, is 0.18 °C at `α = 2.45` (near the
pair's true value) but 3.7 °C at `α = 1.5` and 3.6 °C at `α = 4`. The
application states this caveat in its assumptions list whenever the constant-α
model is selected, and the Validation page reports the current figure.

Because the two are decoupled by construction, the bubble/dew identity of §3 is
a *Raoult* identity and is deliberately **not** asserted under constant α — doing
so would report a false failure. What is asserted there instead is that the
tabulated curve reproduces `y = αx/(1+(α−1)x)` exactly at its nodes, and stays
within the same 1e-4 interpolation bound between them.

## 3. Bubble and dew points

Bubble point — the temperature at which the first bubble forms:

    Σ xᵢ Pᵢˢᵃᵗ(T) = P

Dew point — the temperature at which the first drop forms:

    Σ yᵢ P / Pᵢˢᵃᵗ(T) = 1

Both are solved by **bisection over −80…500 °C with 70 halvings**. Because
`Pˢᵃᵗ(T)` increases monotonically with `T`, the left-hand sides are monotone and
bisection cannot miss the root when one exists inside the bracket. Seventy
halvings reduce the 580 °C bracket to about 5×10⁻¹⁹ °C — far below what a
double-precision float can represent — so in practice the root is resolved to
the floating-point limit, roughly 10⁻¹³ °C at column temperatures.

**Limitation:** the bracket is not validated. A specification whose true bubble
point lies outside −80…500 °C returns the nearest bracket end rather than an
error. Ordinary operating pressures keep the root well inside.

## 4. The equilibrium curve

`curve(s)` tabulates the curve once per (mixture, model, pressure, α, custom
data) at **241 evenly spaced values of x**, storing `y*`, the bubble temperature
and the local `α` at each node. `yEq(x)` interpolates linearly; `xEq(y)` inverts
by binary search plus linear interpolation, which is valid because the ideal
model cannot produce a maximum or minimum in `y*(x)`.

Interpolation error against the underlying Raoult expression is bounded by
**10⁻⁴ mole fraction** and measured at 1.2×10⁻⁵ for benzene/toluene; the test
suite re-measures this on every run.

Azeotropes are **not** predicted — an ideal model cannot produce one. Known
azeotropes are recorded per mixture as data and any specification that crosses
one is flagged as unreachable whatever the model computes.

## 5. Material balance and internal flows

Overall and light-key balances:

    F = D + B                    F z_F = D x_D + B x_B

In design mode these are solved for the products:

    D = F (z_F − x_B)/(x_D − x_B)        B = F − D

Because `D` and `B` are *derived from* these equations, their residuals are zero
by construction. The interface says so explicitly and reports them as an
identity, never as an independent check. The residual that can actually fail is
the numerical one in §7.

**Constant molar overflow.** Assuming equimolar latent heats and negligible
sensible-heat and heat-loss effects, the molar traffic is constant within each
section:

    L = R D        V = (R + 1) D        L̄ = L + q F        V̄ = V − (1 − q) F

`q` is defined as the moles of saturated liquid added to the stripping section
per mole of feed: `q > 1` subcooled liquid, `q = 1` saturated liquid,
`0 < q < 1` two-phase, `q = 0` saturated vapour, `q < 0` superheated vapour. The
model places no artificial bound on `q`; only a finite value is required.

## 6. McCabe–Thiele construction

Under constant molar overflow the operating lines are straight.

Rectifying — a balance around the top of the column and the condenser:

    y = R/(R+1) · x + x_D/(R+1)

Stripping — a balance around the bottom and the reboiler, written through the
point `(x_B, x_B)`:

    y = x_B + m_s (x − x_B)          m_s = (y_int − x_B)/(x_int − x_B)

q-line — the locus of the intersections of the two operating lines:

    y = q/(q−1) · x − z_F/(q−1)

It always passes through `(z_F, z_F)`, is vertical for `q = 1` (handled as a
special case when `|q − 1| < 10⁻⁴`) and horizontal for `q = 0`.

**Stepping.** Starting from `(x_D, x_D)`, each stage steps horizontally to the
equilibrium curve (`x = x*(y)`) and then vertically to whichever operating line
applies, switching at the intersection `x_int` — the optimum feed location.
Stepping stops when `x ≤ x_B`.

Two properties of the construction as implemented:

* **The condenser is total**: `y₁ = x_D`, and it is not an equilibrium stage. A
  partial condenser, which would add one, is not modelled.
* **Stages are whole numbers.** The last stage overshoots `x_B` rather than
  being interpolated to a fraction. The overshoot `x_B − x_N` is reported as a
  discretisation residual. This is standard for a graphical construction, and it
  is why a sensitivity sweep of stage count against reflux is a staircase.

The reboiler is counted as one equilibrium stage, so the actual tray count is

    N_actual = ⌈(N − 1)/E_o⌉        (partial reboiler)

`E_o` is an overall efficiency in `(0, 1]`; Murphree efficiencies are not
resolved per tray.

## 7. Limiting conditions and the two solve modes

**Minimum stages — Fenske.** At total reflux both operating lines collapse onto
the diagonal, so `y_{n+1} = x_n`. Applying the constant-α relation repeatedly
down the column telescopes to

    N_min = ln[ (x_D/(1−x_D)) · ((1−x_B)/x_B) ] / ln α_avg

with `α_avg = √(α_top · α_bottom)` evaluated from the tabulated curve. `N_min`
includes the reboiler.

**Minimum reflux.** At `R_min` an operating line first touches the equilibrium
curve — a pinch — and the stage count diverges. The slope of the limiting
rectifying line through `(x_D, x_D)` and the pinch `(x′, y′)` is

    m = (x_D − y′)/(x_D − x′)        R_min = m/(1 − m)

Two pinches are considered: the q-line intersection with the equilibrium curve,
and a tangent pinch, sought by scanning **59 interior points** between the pinch
and `x_D`. The larger requirement governs. For a strictly convex ideal curve the
tangent case does not arise; it is checked because a non-ideal or user-supplied
curve may not be convex. *Limitation:* the scan spans `[x_pinch, x_D]` only, so
a tangency below the q-line pinch would be missed.

**Design mode** fixes `x_D`, `x_B` and `R` and steps for `N`. It is direct, not
iterative, so there is nothing to converge.

**Rating mode** fixes `N` and the cut `D/F` and shoots on `x_D` by bisection
(70 steps), taking `x_B` from the component balance at each trial. The residual
is

    residual = x_N − x_B

the difference between the liquid the N-th stage actually delivers and the value
the balance requires. **A rating solution is rejected unless
`|x_N − x_B| ≤ 10⁻⁴` mole fraction.** Roughly one sixth of the (N, D/F, R) space
cannot satisfy both constraints; those cases are reported as non-converged with
the residual shown, not presented as results.

## 8. Duties

Latent heat only, with a composition-weighted molar latent heat:

    Q_C = V · λ_top          λ_top = x_D λ_A + (1 − x_D) λ_B
    Q_R = V̄ · λ_bottom       λ_bottom = x_B λ_A + (1 − x_B) λ_B

Reported in MW: `kmol/h × kJ/mol ÷ 3.6 = kW`. Sensible heat, sub-cooling,
feed preheat and heat loss are all excluded, so these are lower bounds on a real
duty. `λ` is taken at the normal boiling point and treated as constant.

## 9. Validation — what is and is not checked

`node tools/test.js` runs the whole suite and exits non-zero on any failure.

**Checked (self-contained):**

| Check | How it is anchored |
| --- | --- |
| Fenske `N_min` | against the closed-form expression, agreement to ~1e-15 |
| Underwood `R_min` | against the closed-form binary result at `q = 1`, ~1e-15 |
| Stage count at total reflux | must equal `⌈N_min⌉` |
| Pure-component vapour pressure | `Pˢᵃᵗ(T_b)` must return 1 atm for all eight components |
| Bubble/dew consistency | `T_bubble(x)` must equal `T_dew(y*(x))` — under the Raoult model only; see §2 for why it does not apply under constant α |
| Equilibrium interpolation | interpolated `y*` against the Raoult expression it tabulates |
| Constant-α curve | `y*` must reproduce `αx/(1+(α−1)x)` exactly at the nodes and to 1e-4 between them, at `α = 1.5, 2.45, 4` |
| Constant-α temperatures | must be identical to the Raoult ones, confirming they never see `α`, and the resulting decoupling must stay disclosed in the assumptions list |
| Engine invariants | balances, CMO relations, stage-to-stage recurrence, monotonicity, `N_min ≤ N`, `R > R_min`, and more — over ~258 feasible cases |
| Design/rating fingerprint | a 648-case SHA-256 that changes if any number changes |
| Input validation | hostile inputs must be rejected with no NaN, no stale result, no uncaught error |
| Save/load | a configuration must round-trip exactly and reproduce the same solution |
| Reported numerics | the interface's stated bracket, iteration count, resolution, scan size, node count and tolerance are re-read from the source |
| Build | `index.html` must be reproducible from `src/` |

**Not checked.** No comparison has been made against published worked examples,
tabulated experimental VLE data, or another simulator. The Antoine constants and
latent heats are taken as given and have not been re-derived. Agreement with the
closed forms above shows the implementation is faithful to *its own model*; it
says nothing about how well that model describes a real column.

## 10. Out of scope

Activity-coefficient models (Wilson, NRTL, UNIQUAC) — non-ideal mixtures are
flagged, not approximated. Multicomponent systems. Rigorous energy balances.
Column hydraulics: flooding, weeping, pressure drop, diameter, sizing. Packed
columns: no HETP, packed height or transfer-unit calculation is performed.
Partial condensers. Murphree efficiencies. Dynamics and control.

DISTILLEX is an educational and conceptual-design tool. Results depend on the
selected model and the assumptions above, and should not be the sole basis for
industrial process design.
