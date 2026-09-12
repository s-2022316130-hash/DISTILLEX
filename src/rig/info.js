/* info.js — the information layer of the industrial simulator.
 *
 * Everything here is descriptive rather than computational: what each piece of
 * equipment is, where the camera should stand to look at it, and the order the
 * guided tour walks the process in. Keeping it out of plant.js means the
 * geometry file stays geometry, and out of the page means the copy can be read
 * and corrected on its own.
 *
 * The `pick` keys are the same strings plant.js stamps into the id buffer, so
 * clicking a vessel in the 3D scene and clicking its block in the 2D diagram
 * resolve to one and the same record.
 */
var RIGINFO = (function () {
  'use strict';

  /* The azimuth the cutaway wedge is cut to face. plant.js derives
     CUTAWAY_YAW from the same number, so the opening and the camera that
     looks into it can never drift apart. */
  var CUTAWAY_VIEW = 0.62;

  /* ── what each component is ───────────────────────────────────────────
   * Four fields, deliberately: name, what it is for, how it works, and what
   * it contributes to the separation. Long enough to be worth reading, short
   * enough to sit in a panel without scrolling.
   */
  var COMPONENTS = {
    crude: {
      name: 'Crude charge line',
      cat: 'Feed',
      purpose: 'Brings desalted crude from tankage to the unit at the rate you set.',
      how: 'A charge pump lifts the crude through the preheat train, where it recovers heat from the products leaving the tower. The preheat outlet temperature is the feed temperature on the panel.',
      role: 'Every mass balance in the simulator starts here: the charge rate is the basis all yields are reported against.',
      reads: ['charge', 'feedT']
    },
    furnace: {
      name: 'Fired heater',
      cat: 'Heat input',
      purpose: 'Raises the crude from the preheat outlet to the temperature that decides how much of it can vaporise.',
      how: 'Crude runs through tubes lining a refractory firebox; burners fire into the box and the flue gas leaves up the stack. The furnace outlet — the transfer-line temperature — is the single most powerful handle on the unit.',
      role: 'The furnace sets the vapour that enters the flash zone. No vapour, nothing to fractionate.',
      reads: ['furnaceT', 'furnaceDuty']
    },
    feed: {
      name: 'Transfer line',
      cat: 'Feed',
      purpose: 'Carries the part-vaporised charge from the heater outlet into the tower.',
      how: 'The stream leaving the furnace is already two-phase. It enters below the wash section, and the flash itself happens as the pressure drops across the inlet device.',
      role: 'The split between vapour and liquid at this point is the flash calculation the whole cascade is built on.',
      reads: ['furnaceT', 'flashP', 'psi']
    },
    tower: {
      name: 'Atmospheric column',
      cat: 'Separation',
      purpose: 'Separates the charge into cuts by boiling range, in one vessel, continuously.',
      how: 'Vapour rises through trays, liquid runs down over them, and the two contact on every tray. Each tray is a stage of equilibrium: the vapour leaves a little lighter, the liquid a little heavier. Temperature falls from the flash zone to the overhead.',
      role: 'This is the separation. Everything else on the plot exists to supply it with heat, reflux, or somewhere to send a product.',
      reads: ['topT', 'flashT', 'topP']
    },
    trays: {
      name: 'Column internals',
      cat: 'Separation',
      purpose: 'Provide the vapour–liquid contact the separation depends on.',
      how: 'Each tray holds a layer of liquid that vapour bubbles through. Liquid crosses the tray, spills over a weir into a downcomer, and joins the tray below. Contact drives each phase toward equilibrium with the other.',
      role: 'The number of trays between two draws sets how sharply those two products are separated from one another.',
      reads: ['stages']
    },
    sidedraw: {
      name: 'Side strippers',
      cat: 'Separation',
      purpose: 'Remove the light ends that come down with each side draw.',
      how: 'Liquid drawn from the tower falls into a small stripping column. Steam entering below lowers the hydrocarbon partial pressure, so the lightest material re-vaporises and returns to the main tower, leaving the product on specification at the front end.',
      role: 'Side stripping is what puts a real front-end specification on kerosene, diesel and gas oil.',
      reads: ['sideSteam']
    },
    overhead: {
      name: 'Overhead line',
      cat: 'Overhead',
      purpose: 'Takes everything that reaches the top of the tower to the condenser.',
      how: 'A large-bore line: the overhead is almost all vapour, so the volumetric flow here is far larger than anywhere else on the unit.',
      role: 'Its temperature is the top-tray temperature, and that temperature is what fixes the naphtha end point.',
      reads: ['topT']
    },
    condenser: {
      name: 'Overhead condenser',
      cat: 'Overhead',
      purpose: 'Condenses the overhead vapour so that reflux and naphtha can be withdrawn as liquid.',
      how: 'An air-cooled bank: the overhead passes through finned tubes while fans push ambient air across them. Its duty is the latent heat of everything that condenses, plus the sensible heat of cooling the rest.',
      role: 'Without a condenser there is no liquid to return, and without returned liquid the rectifying section does not fractionate at all.',
      reads: ['condDuty', 'drum']
    },
    drum: {
      name: 'Reflux drum',
      cat: 'Overhead',
      purpose: 'Separates the condensed overhead into gas, liquid naphtha and water.',
      how: 'A horizontal vessel run part full. Uncondensed gas leaves the top, hydrocarbon liquid the side, and the stripping steam — now condensed water — settles into the boot underneath. Its temperature decides how much stays vapour.',
      role: 'The drum is where the overhead actually splits into two products and the reflux that goes back.',
      reads: ['drum', 'gas']
    },
    reflux: {
      name: 'Reflux line',
      cat: 'Overhead',
      purpose: 'Returns cold liquid to the top tray.',
      how: 'A pump takes liquid from the drum and returns a multiple of the distillate rate to the top of the tower. That multiple is the reflux ratio.',
      role: 'Reflux is the liquid traffic of the rectifying section. More of it means a sharper separation and a colder top, paid for in condenser duty.',
      reads: ['reflux', 'topT']
    },
    reboiler: {
      name: 'Tower base and stripping steam',
      cat: 'Bottoms',
      purpose: 'Holds the unvaporised liquid and strips the last recoverable distillate out of it.',
      how: 'An atmospheric crude tower has no reboiler: putting a fired reboiler on this bottoms would crack it. Superheated steam is injected instead, which lowers the hydrocarbon partial pressure and lets light material leave without raising the temperature.',
      role: 'Steam stripping is what keeps recoverable gas oil out of the residue.',
      reads: ['steam', 'bottomT']
    },
    steam: {
      name: 'Stripping steam header',
      cat: 'Bottoms',
      purpose: 'Supplies superheated steam to the tower base and to each side stripper.',
      how: 'Steam is inert to the hydrocarbons here. It carries no heat duty of consequence; it works by dilution, lowering every hydrocarbon partial pressure so the same component boils at a lower temperature.',
      role: 'The cheapest separating agent on the unit, and the reason a crude tower can run without a reboiler.',
      reads: ['steam', 'sideSteam']
    }
  };

  /* Products get their own records; they are streams rather than equipment. */
  var PRODUCTS = {
    gas:      { name:'Wet gas',   use:'Refinery fuel gas and LPG recovery feed.' },
    naphtha:  { name:'Naphtha',   use:'Reformer feed and gasoline blendstock.' },
    kerosene: { name:'Kerosene',  use:'Jet fuel and lighting kerosene.' },
    diesel:   { name:'Diesel',    use:'Automotive and heating gas oil.' },
    gasoil:   { name:'Heavy gas oil', use:'Cracker and hydrocracker feed.' },
    residue:  { name:'Atmospheric residue', use:'Vacuum unit charge, or heavy fuel oil.' }
  };

  /** The record behind any pick key, product streams included. */
  function describe(key) {
    if (!key) return null;
    if (key.indexOf('product-') === 0) {
      var k = key.slice(8), p = PRODUCTS[k];
      if (!p) return null;
      return {
        key: key, prod: k, name: p.name + ' rundown', cat: 'Product',
        purpose: 'Takes ' + p.name.toLowerCase() + ' off the unit to the pipe rack and on to storage.',
        how: 'A rundown line, cooled against the incoming crude in the preheat train before it reaches tankage.',
        role: p.use, reads: []
      };
    }
    var c = COMPONENTS[key];
    return c ? { key: key, prod: null, name: c.name, cat: c.cat, purpose: c.purpose,
                 how: c.how, role: c.role, reads: c.reads || [] } : null;
  }

  /* ── camera presets ───────────────────────────────────────────────────
   * Built from the plant's own dimensions rather than typed in, so moving a
   * vessel moves the shot that frames it. yaw/pitch are radians, dist metres.
   */
  function cameras(P) {
    var top = P.shellTop, D = P.D, sk = P.skirtTop;
    // Distance is derived from what the shot has to contain rather than typed
    // in, so moving a vessel moves the camera that frames it. The renderer's
    // vertical field of view is 0.62 rad; half of that has a tangent of 0.32.
    function fit(r) { return r / 0.32; }
    var sideMid = P.sideY[1];
    return [
      { key:'plant',     label:'Plant',     t:[-2, top * 0.50, 0],
        yaw:-0.72, pitch:0.15, dist: fit(33) },
      { key:'tower',     label:'Column',    t:[0, sk + D.towerH * 0.5, 0],
        yaw:-0.40, pitch:0.06, dist: fit(25) },
      { key:'cutaway',   label:'Cutaway',   t:[0, sk + D.towerH * 0.5, 0],
        yaw: CUTAWAY_VIEW, pitch:0.05, dist: fit(24) },
      { key:'furnace',   label:'Heater',    t:[D.furX + 1, D.furH * 0.75, D.furZ],
        yaw:-1.02, pitch:0.17, dist: fit(15) },
      { key:'overhead',  label:'Overhead',  t:[(D.condX + D.drumX) * 0.5 - 2, D.condY - 3.5, D.condZ + 2],
        yaw: 1.16, pitch:0.19, dist: fit(15) },
      { key:'strippers', label:'Strippers', t:[D.stripX - 2.6, sideMid - 2, 0],
        yaw: 0.86, pitch:0.30, dist: fit(17) },
      { key:'base',      label:'Base',      t:[0, 5.5, 2],
        yaw:-0.86, pitch:0.06, dist: fit(11) }
    ];
  }

  /** Which preset frames a given component best. */
  var FOCUS = {
    crude:'furnace', furnace:'furnace', feed:'furnace',
    tower:'tower', trays:'cutaway', sidedraw:'strippers',
    overhead:'overhead', condenser:'overhead', drum:'overhead', reflux:'overhead',
    reboiler:'base', steam:'base',
    'product-gas':'overhead', 'product-naphtha':'overhead',
    'product-kerosene':'strippers', 'product-diesel':'strippers',
    'product-gasoil':'strippers', 'product-residue':'base'
  };

  /* ── the guided tour ───────────────────────────────────────────────────
   * A sequence of ordinary selections, so anything the operator does simply
   * takes over. Each stop names what to look at and what to read while there.
   */
  var TOUR = [
    { sel:'crude',     cam:'furnace',   title:'The charge',
      text:'Crude arrives from tankage at the rate on the panel. Everything downstream is reported as a percentage of this number.' },
    { sel:'furnace',   cam:'furnace',   title:'Heat in',
      text:'The fired heater takes the charge to its outlet temperature. Raise it and more of the crude can vaporise; the residue shrinks and every distillate grows.' },
    { sel:'feed',      cam:'furnace',   title:'The flash',
      text:'The transfer line drops into the tower and the stream flashes. The vapour fraction here is a real equilibrium calculation, not a setting.' },
    { sel:'tower',     cam:'tower',     title:'The column',
      text:'Vapour rises, liquid falls, and they meet on every tray. Temperature falls the whole way up, and each product is drawn where the temperature suits it.' },
    { sel:'trays',     cam:'cutaway',   title:'Inside',
      text:'The cutaway shows the internals. More trays between two draws means a sharper separation between those two products.' },
    { sel:'sidedraw',  cam:'strippers', title:'Side strippers',
      text:'Each side draw falls into a small stripper. Steam sends the light ends back to the tower, which is what puts a front-end specification on the product.' },
    { sel:'overhead',  cam:'overhead',  title:'Overhead',
      text:'Everything that reaches the top leaves as vapour, to be condensed and split into gas, naphtha and the reflux that comes back.' },
    { sel:'reflux',    cam:'overhead',  title:'Reflux',
      text:'Returned liquid is what makes the rectifying section work at all. The reflux ratio trades condenser duty for sharpness.' },
    { sel:'reboiler',  cam:'base',      title:'The base',
      text:'No reboiler: heating this bottoms would crack it. Steam does the stripping instead, by lowering every hydrocarbon partial pressure.' }
  ];

  return { COMPONENTS: COMPONENTS, PRODUCTS: PRODUCTS, describe: describe,
           cameras: cameras, FOCUS: FOCUS, TOUR: TOUR };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RIGINFO;
