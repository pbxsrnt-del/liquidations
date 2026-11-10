/* Size lookup for the manifest page. Hand-maintained (the generator does
   not touch this file).

   The manifest has no size column, so sizes are read from three places:
     - bedding: the size abbreviation in the description (KG, FQ, TTXL…)
     - apparel: the fit range in the department (Petite, Tall, Women's…),
       plus the tag size from data/details.js once an item is photographed
     - window and bedding lots: the width printed at the front of the description,
       e.g. 28-48 (an adjustable rod) or 35X64 (a 35 in wide blind)

   LIQ_SIZE.sizes(item)  -> list of size labels for the Size dropdown
   LIQ_SIZE.width(item)  -> [low, high] in inches, or null
   LIQ_SIZE.fits(item,w) -> true if the item suits a window w inches wide */
window.LIQ_SIZE = (function(){
  var APPAREL_LOT = 'J0310832', BEDDING_LOT = 'J0310858', WINDOW_LOT = 'J0310853';

  /* Groups and their order in the dropdown. */
  var GROUPS = [
    ['Bedding', ['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'Cal King']],
    ['Apparel fit', ['Misses', 'Petite', 'Tall', "Women's plus", 'Juniors', "Men's", 'Big & tall', 'Kids']],
    ['Tag size (photographed items)', ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '1X', '2X', '3X',
                  '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24']]
  ];

  /* Bedding abbreviations, one description word at a time. */
  var BED = {
    TW:['Twin'], T:['Twin'], TWIN:['Twin'],
    TXL:['Twin XL'], TLX:['Twin XL'], TX:['Twin XL'], TTXL:['Twin','Twin XL'],
    F:['Full'], FL:['Full'], FULL:['Full'],
    FQ:['Full','Queen'], 'F/Q':['Full','Queen'],
    Q:['Queen'], QN:['Queen'], QUEEN:['Queen'], 'S/Q':['Queen'], 'QN/KG':['Queen','King'],
    K:['King'], KG:['King'], KNG:['King'], KING:['King'],
    KCK:['King','Cal King'], KGCK:['King','Cal King'], KGCKG:['King','Cal King'], 'K/CK':['King','Cal King'],
    CK:['Cal King']
  };

  function bedding(desc){
    var out = [], words = desc.replace(/^\*/, '').toUpperCase().split(/[\s-]+/);
    words.forEach(function(w, i){
      var hit = BED[w];
      /* "K CAL K" and "Q F" are spelled out across words */
      if (w === 'CAL' && words[i+1] === 'K') hit = ['Cal King'];
      if (w === 'F' && words[i-1] === 'Q') hit = ['Full', 'Queen'];
      if (hit) hit.forEach(function(s){ if (out.indexOf(s) < 0) out.push(s); });
    });
    return out;
  }

  function fit(item){
    var dep = (item[5] + ' ' + item[6]).toUpperCase();
    if (/BIG (&|AND) TALL|BIG\/TALL/.test(dep)) return ['Big & tall'];
    if (/PETITE/.test(dep)) return ['Petite'];
    if (/TALL/.test(dep)) return ['Tall'];
    if (/WOMEN'?S SIZE|WOMEN'?S SPORTSWEAR|PLUS/.test(dep)) return ["Women's plus"];
    if (/JUNIOR|JR /.test(dep)) return ['Juniors'];
    if (/BOYS|GIRLS|BABY|TODDLER|KIDS/.test(dep)) return ['Kids'];
    if (/^MEN|YOUNG MEN/.test(dep)) return ["Men's"];
    if (/MISSES|CAREER|CASUAL|CONTEMPORARY|DRESSES/.test(dep)) return ['Misses'];
    return [];
  }

  /* Tag size typed into data/details.js, e.g. "2XL / 3XL", "PM (Petite Medium)". */
  function tag(size, bed){
    var out = [], s = String(size).toUpperCase();
    if (bed) return bedTag(s);
    var named = {'EXTRA LARGE':'XL', 'EXTRA SMALL':'XS', 'SMALL':'S', 'MEDIUM':'M', 'LARGE':'L'};
    Object.keys(named).forEach(function(k){
      if (s.indexOf(k) >= 0 && s.indexOf('(') < 0) { out.push(named[k]); s = s.replace(k, ''); }
    });
    s.replace(/\(.*?\)/g, '').split(/[\s\/,]+/).forEach(function(w){
      w = w.replace(/^P(?=[SML]$)/, '');            /* PM = petite medium */
      if (w === 'XXL') w = '2XL';
      if (/^(XS|S|M|L|XL|2XL|3XL|1X|2X|3X)$/.test(w) || /^(0|2|4|6|8|1[02468]|2[024])$/.test(w)) out.push(w);
    });
    return out;
  }

  function bedTag(s){
    var out = [];
    if (/\bQUEEN\b/.test(s)) out.push('Queen');
    if (/\bCAL KING\b/.test(s)) out.push('Cal King');
    if (/\bKING\b/.test(s.replace('CAL KING', ''))) out.push('King');
    if (/\bFULL\b/.test(s)) out.push('Full');
    if (/\bTWIN XL\b/.test(s)) out.push('Twin XL');
    else if (/\bTWIN\b/.test(s)) out.push('Twin');
    return out;
  }

  function sizes(item){
    var out = [];
    function add(list){ list.forEach(function(s){ if (out.indexOf(s) < 0) out.push(s); }); }
    if (item[1] === BEDDING_LOT) add(bedding(item[2]));
    else if (item[1] !== WINDOW_LOT) add(fit(item));
    var d = (window.LIQ_DETAILS || {})[item[0]];
    if (d && d.size && item[1] !== WINDOW_LOT) add(tag(d.size, item[1] === BEDDING_LOT));
    return out;
  }

  /* Width in inches from the front of a window-lot description.
     "30 1/8-36X54-60" -> [30.125, 36];  "35X64 SOMRTN" -> [35, 35];
     "28 48 ISABELLA" -> [28, 48];  "48 CHELSEA 5/8IN" -> [48, 48]. */
  function width(item){
    if (item[1] === APPAREL_LOT) return null;
    /* fold fractions in first: "30 1/8" and "31-1/8" both become 30.125 / 31.125 */
    var s = item[2].replace(/^\*/, '').toUpperCase()
      .replace(/(\d+)[ -](\d)\/(\d+)/g, function(_, n, a, b){ return String(+n + a / b); });
    var m = s.match(/^(?:[A-Z]+ ){0,3}(\d+(?:\.\d+)?)(?:\s*-\s*|\s+)(\d+(?:\.\d+)?)(?=\D|$)/);
    if (m && +m[1] >= 12 && +m[2] > +m[1]) return [+m[1], +m[2]];
    /* in bedding, a lone number is a thread count ("500 TC"), not a width */
    if (item[1] === BEDDING_LOT) return null;
    m = s.match(/^(?:[A-Z]+ ){0,3}(\d+(?:\.\d+)?)\s*(?:X|IN\b|\s+[A-Z])/);
    if (m && +m[1] >= 12) return [+m[1], +m[1]];
    return null;
  }

  /* Adjustable pieces fit anywhere in their range; fixed widths within an inch. */
  function fits(item, w){
    var r = width(item);
    if (!r) return false;
    return r[0] === r[1] ? Math.abs(r[0] - w) <= 1 : (w >= r[0] - 0.5 && w <= r[1] + 0.5);
  }

  return {GROUPS:GROUPS, sizes:sizes, width:width, fits:fits};
})();
