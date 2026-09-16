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
  /* Where each product goes, and why the tank that holds it is built the way
     it is. Tank type follows the flash point and the vapour pressure of what
     is in it, which is why a farm is not a row of identical cylinders. */
  var TANKS = {
    crude:    ['TK-101', 'Crude charge tankage', 'External floating roof',
               'The deck floats on the liquid, so there is no vapour space above it to breathe out as the day warms. Crude is volatile enough that a fixed roof would lose stock and make the tank a hazard.'],
    naphtha:  ['TK-201', 'Naphtha rundown tank', 'External floating roof',
               'Naphtha has the highest vapour pressure of the liquid cuts, so it is kept under a floating deck for the same reason the crude is: no vapour space, no breathing loss.'],
    kerosene: ['TK-202', 'Kerosene rundown tank', 'Internal floating roof',
               'A fixed roof with a floating deck inside it and a ring of vents in the shell. Kerosene sits in the middle of the flash-point range: the deck cuts the losses, the fixed roof keeps the weather off a product that has to stay clean enough to burn in a turbine.'],
    diesel:   ['TK-203', 'Diesel rundown tank', 'Fixed cone roof',
               'The flash point is high enough that the vapour space above the liquid is not flammable at ambient temperature, so a plain welded cone roof is all it needs.'],
    gasoil:   ['TK-204', 'Heavy gas oil tank', 'Fixed cone roof',
               'Cracker feed rather than a finished product. Like diesel it is too heavy to need a deck; unlike diesel it usually leaves again by pipeline rather than by road.'],
    residue:  ['TK-205', 'Atmospheric residue tank', 'Lagged, steam-coil heated',
               'Residue is solid, or near it, at ambient temperature. The tank is clad and carries a steam coil along the bottom, because a tank of cold residue cannot be pumped out of.'],
    gas:      ['V-301', 'LPG spheres', 'Horton spheres, under pressure',
               'Propane and butane are gases at ambient pressure, so they are not stored in a tank at all: they are liquefied under pressure in spheres, which is the shape that carries an internal pressure with the least steel. Refineries run them in groups on a common manifold.']
  };

  var COMPONENTS = {
    preheat: {
      name: 'Preheat exchanger train',
      cat: 'Heat recovery',
      purpose: 'Takes the cold crude most of the way to furnace temperature using heat that would otherwise be thrown away.',
      how: 'Crude runs through the tubes of a series of shell-and-tube exchangers; the shells carry hot products and pumparound liquid on their way out of the unit. A crude unit typically recovers enough here to reach 230-280 \u00b0C before the heater sees the feed.',
      role: 'The train is why a crude unit is affordable to run: every degree recovered here is a degree the furnace does not have to fire for.',
      reads: ['feedT', 'charge']
    },
    desalter: {
      name: 'Desalter',
      cat: 'Feed treatment',
      purpose: 'Washes the chloride salts out of the crude before it is heated any further.',
      how: 'Wash water is mixed into the crude through a mixing valve at around 120-140 \u00b0C, and the emulsion is broken in an electrostatic field between plates inside the vessel. Brine settles to the boot; desalted crude leaves the top.',
      role: 'Salts left in the feed hydrolyse to hydrochloric acid in the tower overhead. Desalting is a corrosion-control step, not a separation.',
      reads: ['charge']
    },
    preflash: {
      name: 'Preflash drum',
      cat: 'Feed treatment',
      purpose: 'Drops the lightest ends out of the crude before the furnace.',
      how: 'Partly preheated crude is flashed in a drum; the vapour goes forward to the tower overhead system and the liquid carries on to the rest of the preheat train and the heater.',
      role: 'Taking the light ends out ahead of the heater unloads the furnace and the transfer line, and lets the preheat train run at a lower pressure.',
      reads: ['charge', 'feedT']
    },
    pumparound: {
      name: 'Pumparound circuit',
      cat: 'Heat removal',
      purpose: 'Takes heat out of the tower part way up and gives it to the crude.',
      how: 'Hot liquid is drawn from a chimney tray, pumped through an exchanger against crude, and returned to the tower a few trays higher, where it condenses vapour and creates the internal reflux for the section below. A crude tower normally runs three of them.',
      role: 'Pumparound duty is what sets the internal liquid traffic in each section; it is also where most of the tower heat is recovered rather than rejected to air.',
      reads: ['feedT']
    },
    compressor: {
      name: 'Wet gas compressor',
      cat: 'Overhead',
      purpose: 'Lifts the uncondensed overhead gas to the pressure the gas plant needs.',
      how: 'Gas off the reflux drum is compressed and sent on for recovery of the propane and butane in it.',
      role: 'It sets the pressure the reflux drum runs at, and with it the tower overhead pressure.',
      reads: ['topP']
    },
    offplot: {
      name: 'Off-plot facilities',
      cat: 'Site',
      purpose: 'Everything on the plot that serves the unit without being part of it.',
      how: 'Tankage for the charge and the rundowns, the flare that takes relief and off-spec material, the cooling tower, and the control room and substation that run and power the place.',
      role: 'Nothing here changes a separation; the unit could not be operated without any of it.',
      reads: []
    },
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
  // The tank records are generated from the table above rather than written
  // out seven times: every one says the same four things about a different
  // product, and a table is the honest shape for that.
  Object.keys(TANKS).forEach(function (k) {
    var T = TANKS[k];
    COMPONENTS['tank-' + k] = {
      name: T[1], cat: 'Storage',
      purpose: 'Holds the ' + (k === 'crude' ? 'charge before it enters the unit'
                                             : k + ' the unit makes, between the rundown and whatever takes it away') + '.',
      how: T[2] + '. ' + T[3],
      role: 'Nothing is separated here. The farm is where the answer the unit computes physically ends up.',
      reads: []
    };
  });

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
    // `w` is the half-width, in metres, that a shot has to keep in frame. The
    // two wide shots are wider than they are tall, so on a narrow screen the
    // vertical fit above is not the binding constraint — the camera has to
    // stand further back or a phone sees two tanks out of seven. rigCamTo
    // turns it into a distance once it knows the canvas aspect.
    var sideMid = P.sideY[1];
    return [
      // The site. The unit is no longer the whole plot — there is a preheat
      // train and a desalter to the west, a tank farm and a flare beyond it —
      // so the widest shot has to contain the place, not just the tower.
      { key:'site',      label:'Site',      t:[2, top * 0.34, -14],
        yaw:-0.62, pitch:0.24, dist: fit(96), w: 112 },
      { key:'plant',     label:'Unit',      t:[-2, top * 0.50, 0],
        yaw:-0.72, pitch:0.15, dist: fit(36) },
      { key:'frontend',  label:'Front end', t:[-34, 6.5, -10],
        yaw:-1.10, pitch:0.20, dist: fit(26) },
      // Where the products actually end up. The row of tanks runs east-west
      // behind the unit, so the shot is taken from due north of it, looking
      // back south: the five rundown tanks lie across the frame at the same
      // distance, with the unit that filled them standing behind. From any
      // other azimuth the tower is in front of the tanks and hides them.
      { key:'farm',      label:'Tank farm', t:[-19, 13, -46],
        yaw: Math.PI, pitch:0.20, dist: fit(66), w: 68,
        // Upright, the row cannot be shown broadside: a hundred and ninety
        // metres of tankage across a screen four hundred pixels wide is a
        // smudge. So a phone is stood at the end of the row instead and looks
        // along it — the same tanks, using the tall dimension it actually has.
        port: { t:[-14, 9, -46], yaw:-1.38, pitch:0.42,
                dist: fit(92), w: 0 } },
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
      { key:'pumps',     label:'Pumparounds', t:[-16, 7, -20],
        yaw:-0.30, pitch:0.24, dist: fit(16) },
      { key:'base',      label:'Base',      t:[0, 5.5, 2],
        yaw:-0.86, pitch:0.06, dist: fit(11) }
    ];
  }

  /** Which preset frames a given component best. */
  var FOCUS = {
    crude:'frontend', furnace:'furnace', feed:'furnace',
    desalter:'frontend', preheat:'frontend', preflash:'frontend',
    pumparound:'pumps', compressor:'overhead', offplot:'site',
    'tank-crude':'frontend', 'tank-naphtha':'farm', 'tank-kerosene':'farm',
    'tank-diesel':'farm', 'tank-gasoil':'farm', 'tank-residue':'farm', 'tank-gas':'farm',
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
