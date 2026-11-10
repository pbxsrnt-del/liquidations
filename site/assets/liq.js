/* Shared helpers for every page. Hand-maintained: build/generate.py no
   longer writes this file.

   Item details come from two places, merged per SKU:
     window.LIQ_DETAILS  data/details.js, the hand-edited file
     window.LIQ_LIVE     data/live.js, written by the phone editor
                         (admin.html). On the live site this is served
                         by _worker.js from the database; anywhere else
                         it is an empty placeholder.
   A live record replaces the hand-edited one for that SKU. */
window.LIQ = (function(){
  var RATE = 0.45;                       /* our price = 45% of the store ticket */
  var D = {}, k;
  var S = window.LIQ_DETAILS || {}, L = window.LIQ_LIVE || {};
  for (k in S) D[k] = S[k];
  for (k in L) D[k] = L[k];
  var LOTS = window.LIQ_LOTS || {};

  function detail(sku){ return D[sku] || {}; }

  /* Standard price: 45% of the ticket, rounded to the dollar.
     A detail record may set price to mark one item down; nothing else may. */
  function standard(item){ return Math.round(item[4] * RATE); }
  function price(item){
    var d = detail(item[0]);
    return (typeof d.price === 'number') ? Math.round(d.price) : standard(item);
  }
  function marked(item){ return price(item) !== standard(item); }
  function saving(item){ return Math.round(100 * (1 - price(item) / item[4])); }

  function state(sku){
    var d = detail(sku);
    if (d.status === 'sold' || d.status === 'hold') return d.status;
    return (d.photos && d.photos.length) ? 'listed' : 'todo';
  }

  function chip(s){
    if (s === 'sold') return '<span class="chip chip--sold">Sold</span>';
    if (s === 'hold') return '<span class="chip chip--hold">On hold</span>';
    if (s === 'listed') return '<span class="chip chip--live">Photos</span>';
    return '<span class="chip chip--todo">No photos yet</span>';
  }

  function usd(n){ return '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function whole(n){ return '$' + Math.round(n).toLocaleString('en-US'); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  var BY = null;
  function bySku(sku){
    if (!BY){ BY = {}; (window.LIQ_ITEMS || []).forEach(function(it){ BY[it[0]] = it; }); }
    return BY[sku] || null;
  }

  function lot(item){ return LOTS[item[1]] || {}; }
  function title(item){ return (detail(item[0]).title || '').trim() || item[2]; }

  /* What the shop shows: every line with at least one photo, newest first.
     Live edits carry an `updated` time; hand-edited records keep the order
     they appear in data/details.js, newest assumed last. */
  function shopItems(withSold){
    var order = Object.keys(S), out = [];
    Object.keys(D).forEach(function(sku){
      var it = bySku(sku), d = D[sku];
      if (!it || !d.photos || !d.photos.length) return;
      if (!withSold && d.status === 'sold') return;
      out.push(it);
    });
    function rank(it){
      var d = D[it[0]];
      if (d.updated) return d.updated;
      return order.indexOf(it[0]);           /* small numbers: older */
    }
    return out.sort(function(a, b){ return rank(b) - rank(a); });
  }

  /* One product card, used by the shop and the front page. */
  function card(it){
    var d = detail(it[0]), s = state(it[0]), p = price(it);
    var bits = [d.size, d.color].filter(Boolean).map(esc).join(' &middot; ');
    return '<a class="pcard' + (s === 'sold' ? ' is-sold' : '') + '" href="item.html?sku=' + it[0] + '">' +
      '<span class="pcard-img"><img loading="lazy" src="' + esc(d.photos[0]) + '" alt="">' +
        (s === 'sold' || s === 'hold' ? chip(s) : '') + '</span>' +
      '<span class="pcard-body">' +
        (d.brand ? '<span class="pcard-brand">' + esc(d.brand) + '</span>' : '') +
        '<span class="pcard-title">' + esc(title(it)) + '</span>' +
        (bits ? '<span class="pcard-meta">' + bits + '</span>' : '') +
        '<span class="pcard-price"><b>' + whole(p) + '</b>' +
          '<s>' + whole(it[4]) + ' in store</s></span>' +
      '</span></a>';
  }

  return {RATE:RATE, detail:detail, price:price, standard:standard, marked:marked,
          saving:saving, state:state, chip:chip, usd:usd, whole:whole, esc:esc,
          bySku:bySku, lot:lot, title:title, shopItems:shopItems, card:card, LOTS:LOTS};
})();
