/**
 * Frisco Christmas Lights - backend (Google Apps Script)
 *  1) Website: house photos from the quote form -> Gmail (unchanged)
 *  2) Estimate app: price list, send estimates, customer approval, office notification
 *
 * First time: choose "setup" in the function dropdown above and click Run.
 */

var BRAND = {
  name: 'Frisco Christmas Lights',
  legal: 'Frisco Christmas Lights LLC',
  phone: '(972) 556-5120',
  email: 'friscolights@gmail.com',
  site: 'https://friscolights.com',
  red: '#A2021F', gold: '#AC893E', ink: '#2B201C',
  logo: 'https://friscolights.com/email-logo.jpg'
};
var PROPS = PropertiesService.getScriptProperties();
var LEAD_HEADERS = ['Lead #', 'Received', 'Status', 'Name', 'Phone', 'Email', 'Address', 'Street', 'City', 'ZIP',
  'Property type', 'Light color', 'Color combination', 'Custom colors', 'Request', 'Photo file', 'Estimate #'];
var EST_HEADERS = ['Estimate #', 'Created', 'Status', 'Customer', 'Phone', 'Email', 'Street', 'City', 'ZIP',
  'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Notes', 'Approved at', 'Approved via', 'Items JSON', 'Token'];


/* ======================= ESTIMATE WORDING ======================= */
var ABOUT_TEXT = 'Every light we install is commercial-grade LED material, custom fit specifically to your home. Your Year 1 price covers your installation and all materials. Once your Year 1 invoice is paid, the lights are yours to keep. Your lights are backed by our lifetime warranty on all materials we provide (see Terms and Conditions for details). After the New Year, we\u2019ll take your display down for you, and next fall we\u2019ll reach out to confirm your installation at your locked Year 2 rate.';
var TERMS = [
  ['Ownership of materials', 'All lighting materials remain the property of Frisco Christmas Lights LLC until the Year 1 invoice is paid in full. Once paid in full, ownership of the materials transfers to the customer.'],
  ['Payment and late fees', 'An invoice will be sent once installation is complete. Payment is due within 30 days of the invoice date. If payment is not received within 30 days, a late fee of $20.00 per day will be added for each day the balance remains unpaid.'],
  ['Lifetime warranty', 'Your lights are covered by a lifetime warranty for as long as Frisco Christmas Lights LLC is the company that installs them each year. The warranty covers all materials provided by Frisco Christmas Lights. It does not cover sun fade, damage from severe weather, or extensive physical damage caused by people. Skipped years: if you skip one or more years, your warranty remains valid once we verify the lights were not installed by another party during that time. Installation by others: if your lights are installed by any other person or company, the lifetime warranty is no longer valid, even if you return to Frisco Christmas Lights for future installations.'],
  ['Annual service', 'Each year, Frisco Christmas Lights will remove your display after the New Year and contact you the following fall to confirm your next installation at your locked Year 2 rate.']
];
var TERMS_CLOSE = 'By signing this estimate, you agree to these terms.';
function year2_(est) { return isRep_(est) ? round2(est.origLabor) : round2((Number(est.total) || 0) / 2); }   // new: half of Year 1 | repurpose: original labor rate

/* ---- Repurpose (customer moving) estimate wording ---- */
function isRep_(est) { return String(est && est.type || '').toLowerCase() === 'repurpose'; }
function repFeet_(est) { return est.lines.reduce(function (a, l) { return a + (l.unit === 'ft' ? Number(l.qty) || 0 : 0); }, 0); }
function repFee_(est) { return round2(est.lines.reduce(function (a, l) { return a + (l.unit === 'ft' ? Number(l.amount) || 0 : 0); }, 0)); }
function repRate_(est) { var l = est.lines.filter(function (x) { return x.unit === 'ft'; })[0]; return l ? Number(l.rate) : settings().repurposeRate; }
function repPoints_(est) {
  var lab = '$' + money(est.origLabor), rate = '$' + money(repRate_(est));
  return [
    ['Your lights move with you.', 'We’ll take the lights from your previous home, re-fit them, and install them at your new home.'],
    ['This year:', 'your locked reinstallation rate of ' + lab + ', plus a one-time repurposing fee of ' + rate + ' per foot for the ' + repFeet_(est) + ' ft we re-fit and install at your new home ($' + money(repFee_(est)) + ').'],
    ['Every year after:', 'you’re back to your locked reinstallation rate of ' + lab + ' per year. No repurposing fee.'],
    ['Using all of your lights.', 'Our goal is to use every light from your previous home. If some of your lights don’t fit the new home, we’ll adjust your reinstallation rate to match what’s installed.'],
    ['Need more lights?', 'If your new home needs more lights than you already own, we’ll send you a separate estimate for the new lights before adding anything.'],
    ['Your warranty moves too.', 'Your lifetime warranty stays with your lights at your new home.']
  ];
}
function repTerms_(est) {
  return [
    ['Repurposing fee', 'The repurposing fee of $' + money(repRate_(est)) + ' per foot is a one-time charge for re-fitting and installing your existing lights at your new home this season. It does not apply to future years.'],
    ['Existing materials', 'This estimate covers the lights you already own from your previous installation. If your existing lights do not cover your new home, any additional lights will be quoted on a separate estimate and will not be added without your approval. If some of your existing lights are not used at your new home, your reinstallation rate will be adjusted to match what is installed.'],
    TERMS[1], TERMS[2],
    ['Annual service', 'Each year, Frisco Christmas Lights will remove your display after the New Year and contact you the following fall to confirm your next installation at your locked reinstallation rate.']
  ];
}
function terms_(est) { return isRep_(est) ? repTerms_(est) : TERMS; }
// [year-1 label, sub, year-2 label, sub, small print]
function labels_(est) {
  return isRep_(est)
    ? ['This year', 'Reinstallation + one-time repurposing fee', 'Every year after', 'Your locked reinstallation rate', 'The repurposing fee is a one-time charge for this year’s move. Starting next year, you’re back to your locked reinstallation rate.']
    : ['Year 1', 'Installation and materials', 'Year 2 and beyond', 'Annual reinstallation, locked rate', 'Your Year 2 rate is locked in for every year Frisco Christmas Lights reinstalls your display.'];
}
function aboutHtml_(est, fs) {
  if (!isRep_(est)) return esc(ABOUT_TEXT);
  return repPoints_(est).map(function (p) { return '<div style="margin:0 0 6px;' + (fs ? 'font-size:' + fs : '') + '"><b>' + esc(p[0]) + '</b> ' + esc(p[1]) + '</div>'; }).join('');
}
function aboutTitle_(est) { return isRep_(est) ? 'How your move works' : 'About your lights'; }

/* ======================= ONE-TIME SETUP ======================= */
function setup() {
  var ss, id = PROPS.getProperty('SHEET_ID');
  if (id) { ss = SpreadsheetApp.openById(id); }
  else { ss = SpreadsheetApp.create('Frisco Lights - Estimates'); PROPS.setProperty('SHEET_ID', ss.getId()); }

  var st = ss.getSheetByName('Settings');
  if (!st) {
    st = ss.insertSheet('Settings');
    st.getRange(1, 1, 7, 3).setValues([
      ['Setting', 'Value', 'Notes'],
      ['App PIN', '1225', 'Code you type into the Estimates app. Change it to your own.'],
      ['Office email', BRAND.email, 'Older setting. Only used if Estimates inbox is blank.'],
      ['Minimum project', 500, 'Smallest total you will quote. Use 0 for no minimum.'],
      ['Tax rate %', 0, 'Leave 0 unless your accountant says to charge sales tax.'],
      ['Estimate valid (days)', 30, 'Shown on the estimate.'],
      ['Footer note', 'Price includes design, professional installation, in-season service, and January takedown.', 'Printed on every estimate.']
    ]);
    st.getRange('A1:C1').setFontWeight('bold'); st.setColumnWidth(1, 170); st.setColumnWidth(2, 260); st.setColumnWidth(3, 420);
  }

  // Add any newer settings rows without touching existing values
  var have = st.getRange(1, 1, st.getLastRow(), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  [['Estimates inbox', 'info.friscolights@gmail.com', 'Gets copies of every estimate you send, plus customer replies to estimates.'],
   ['Approved jobs inbox', BRAND.email, "Gets the 'Approved - add to QuickBooks' email once a customer approves."],
   ['Repurpose rate per ft', 1, 'One-time repurposing fee per foot when a customer moves their lights to a new home.']
  ].forEach(function (r) { if (have.indexOf(r[0]) < 0) st.appendRow(r); });

  var pr = ss.getSheetByName('Prices');
  if (!pr) {
    pr = ss.insertSheet('Prices');
    pr.getRange(1, 1, 12, 4).setValues([
      ['Item', 'Unit', 'Price', 'Active (Y/N)'],
      ['Roofline C9 lights', 'ft', 5, 'Y'],
      ['Ground / pathway lights', 'ft', 4, 'Y'],
      ['Tree wrap - small', 'each', 150, 'Y'],
      ['Tree wrap - medium', 'each', 300, 'Y'],
      ['Tree wrap - large', 'each', 550, 'Y'],
      ['Bush / shrub', 'each', 50, 'Y'],
      ['Window outline', 'each', 60, 'Y'],
      ['Column / pillar wrap', 'each', 75, 'Y'],
      ['Lit wreath', 'each', 150, 'Y'],
      ['Lit garland', 'ft', 12, 'Y'],
      ['Timer / power setup', 'each', 0, 'N']
    ]);
    pr.getRange('A1:D1').setFontWeight('bold'); pr.setColumnWidth(1, 220); pr.setFrozenRows(1);
  }

  var es = ss.getSheetByName('Estimates');
  if (!es) {
    es = ss.insertSheet('Estimates');
    es.getRange(1, 1, 1, EST_HEADERS.length).setValues([EST_HEADERS]).setFontWeight('bold');
    es.setFrozenRows(1);
    es.hideColumns(EST_HEADERS.indexOf('Items JSON') + 1, 2);
  }
  leadsSheet_(ss);
  photoFolder_();
  if (headerIndex(es)['Lead #'] === undefined) es.getRange(1, es.getLastColumn() + 1).setValue('Lead #').setFontWeight('bold');
  ['Preview file', 'Signed name', 'Signed at', 'Type', 'Original labor'].forEach(function (c) { ensureCol_(es, c); });
  Logger.log(logoDataUri_() ? 'Logo found on friscolights.com' : 'Logo not found yet - upload email-logo.jpg to GitHub');
  var s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  Logger.log('All set! Your sheet: ' + ss.getUrl());
  Logger.log('Edit your prices, PIN and office email in that sheet, then redeploy (Deploy > Manage deployments > Edit > New version).');
}

/* ======================= ROUTING ======================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.a === 'approve') return signPage(p.id, p.t);
    if (p.a === 'prices') { requirePin(p.pin); return json({ ok: true, items: getPrices(), settings: publicSettings() }); }
    if (p.a === 'recent') { requirePin(p.pin); return json({ ok: true, leads: openLeads(), estimates: recentEstimates(60) }); }
    if (p.a === 'est') { requirePin(p.pin); return json(estimateDetail(p.id, p.photo === '1')); }
    if (p.a === 'pdf') { requirePin(p.pin); return json(estimatePdfData(p.id)); }
    if (p.a === 'lead') { requirePin(p.pin); return json(leadDetail(p.id, p.photo === '1')); }
    return text('ok');
  } catch (err) { return json({ ok: false, error: String(err.message || err) }); }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.key === 'fcl-lead' || d.key === 'fcl-photo') return handleWebsiteLead(d);   // website quote form
    requirePin(d.pin);
    if (d.a === 'estimate') return json(createEstimate(d));
    if (d.a === 'preview') return json(previewEstimate(d));
    if (d.a === 'approve') { var r = approveEstimate(d.id, null, 'Marked approved in app'); return json(r); }
    if (d.a === 'dismiss') return json(setLeadStatus(d.id, 'Dismissed'));
    return json({ ok: false, error: 'Unknown action' });
  } catch (err) { return json({ ok: false, error: String(err.message || err) }); }
}

/* ======================= WEBSITE LEADS (+ house photo) ======================= */
function handleWebsiteLead(d) {
  if (d._gotcha) return text('ok');
  var c = function (v, n) { return clean(v, n || 200); };
  var name = c(d.name), phone = c(d.phone), email = c(d.email), address = c(d.address);
  if (!name && !phone && !d.photo) return text('empty');

  var inbox; try { inbox = settings().estimatesInbox; } catch (e) { inbox = Session.getEffectiveUser().getEmail(); }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var leadId = '', photoBlob = null, fileId = '';
  try {
    if (d.photo && d.photo.length < 12000000) {
      var type = /^image\//.test(d.type || '') ? d.type : 'image/jpeg';
      photoBlob = Utilities.newBlob(Utilities.base64Decode(d.photo), type, d.filename || 'house-photo.jpg');
    }
    var sh = leadsSheet_(), parts = parseAddress(address);
    leadId = 'L-' + (1000 + sh.getLastRow());
    if (photoBlob) {
      var f = photoFolder_().createFile(photoBlob.copyBlob().setName(leadId + ' - ' + (name || 'house') + '.jpg'));
      fileId = f.getId();
    }
    sh.appendRow([leadId, new Date(), 'New', name, phone, email, address, parts.street, parts.city, parts.zip,
      c(d.type_prop || d.propertyType), c(d.color), c(d.color_combination), c(d.custom_colors), c(d.message, 2000), fileId, '']);
  } finally { lock.releaseLock(); }

  if (photoBlob) {
    var msg = {
      to: inbox,
      subject: 'House photo for lighting preview: ' + (name || 'New customer') + (address ? ' - ' + address : '') + ' (' + leadId + ')',
      body: 'A customer added a photo of their house to their quote request.\n\nName: ' + name + '\nPhone: ' + phone +
        '\nEmail: ' + email + '\nAddress: ' + address + '\n\nThe photo is attached, and this lead is waiting in the Estimates app.',
      attachments: [photoBlob]
    };
    if (validEmail(email)) msg.replyTo = email;
    MailApp.sendEmail(msg);
  }
  return text('ok');
}

function parseAddress(a) {
  a = String(a || '').trim();
  var zip = (a.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/) || [])[1] || '';
  var parts = a.split(',').map(function (x) { return x.trim(); }).filter(String);
  var street = parts[0] || a, city = '';
  if (parts.length > 1) city = parts[1].replace(/\b(TX|Texas)\b/i, '').replace(/\d{5}(-\d{4})?/, '').trim();
  return { street: street, city: city, zip: zip };
}

function leadsSheet_(ss) {
  ss = ss || ss_();
  var sh = ss.getSheetByName('Leads');
  if (!sh) {
    sh = ss.insertSheet('Leads');
    sh.getRange(1, 1, 1, LEAD_HEADERS.length).setValues([LEAD_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function photoFolder_() {
  var id = PROPS.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Frisco Lights - House photos');
  PROPS.setProperty('PHOTO_FOLDER_ID', f.getId());
  return f;
}
function findLeadRow(id) {
  var sh = leadsSheet_(), ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = ids.length - 1; i >= 1; i--) if (ids[i][0] === id) return i + 1;
  return 0;
}
function setLeadStatus(id, status, estimateId) {
  var sh = leadsSheet_(), row = findLeadRow(id); if (!row) return { ok: false, error: 'Lead not found' };
  var h = headerIndex(sh);
  sh.getRange(row, h['Status'] + 1).setValue(status);
  if (estimateId) sh.getRange(row, h['Estimate #'] + 1).setValue(estimateId);
  return { ok: true };
}
function leadObj_(r, h) {
  return { id: r[h['Lead #']], date: r[h['Received']] instanceof Date ? fmtDate(r[h['Received']]) : '', status: r[h['Status']],
    name: r[h['Name']], phone: String(r[h['Phone']] || ''), email: r[h['Email']], address: r[h['Address']],
    street: r[h['Street']], city: r[h['City']], zip: String(r[h['ZIP']] || ''), propertyType: r[h['Property type']],
    color: r[h['Light color']], combo: r[h['Color combination']], customColors: r[h['Custom colors']],
    request: r[h['Request']], hasPhoto: !!r[h['Photo file']] };
}
function openLeads() {
  var sh = leadsSheet_(), last = sh.getLastRow(); if (last < 2) return [];
  var h = headerIndex(sh);
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues()
    .filter(function (r) { return r[h['Status']] === 'New'; }).reverse().map(function (r) { return leadObj_(r, h); });
}
function leadDetail(id, withPhoto) {
  var sh = leadsSheet_(), row = findLeadRow(id); if (!row) return { ok: false, error: 'Lead not found' };
  var h = headerIndex(sh), r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0], lead = leadObj_(r, h);
  if (withPhoto && r[h['Photo file']]) {
    try {
      var b = DriveApp.getFileById(r[h['Photo file']]).getBlob();
      if (b.getBytes().length > 6000000) lead.photoError = 'Photo is too large to show here.';
      else { lead.photo = Utilities.base64Encode(b.getBytes()); lead.photoType = b.getContentType(); }
    } catch (e) { lead.photoError = 'Could not open the photo: ' + e; }
  }
  return { ok: true, lead: lead };
}

/* ======================= ESTIMATES ======================= */
function buildEst_(d, s) {
  var c = d.customer || {};
  if (!clean(c.name)) throw new Error('Customer name is required');
  if (!clean(c.street)) throw new Error('Street address is required');

  // Rebuild every line from the price sheet so totals can't be wrong
  var priceMap = {}; getPrices().forEach(function (p) { priceMap[p.item] = p; });
  var lines = [], isRep = String(d.type || '') === 'repurpose', origLabor = round2(Math.max(0, Number(d.originalLabor) || 0));
  if (isRep) {
    if (!(origLabor > 0)) throw new Error('Add the original labor cost');
    lines.push({ desc: 'Reinstallation (your locked yearly rate)', qty: 1, unit: '', rate: origLabor, amount: origLabor });
  }
  var ftCount = 0;
  (d.items || []).forEach(function (it) {
    var p = priceMap[it.item], q = Number(it.qty) || 0;
    if (!p || !(q > 0)) return;
    if (isRep) {
      if (p.unit !== 'ft') return;
      var rr = s.repurposeRate; ftCount += q;
      lines.push({ desc: p.item + ' (repurpose)', qty: q, unit: 'ft', rate: rr, amount: round2(q * rr) });
    } else lines.push({ desc: p.item, qty: q, unit: p.unit, rate: p.price, amount: round2(q * p.price) });
  });
  if (isRep && !ftCount) throw new Error('Add the footage for the new home');
  (d.custom || []).forEach(function (x) {
    var amt = Number(x.amount) || 0, desc = clean(x.desc);
    if (desc && amt) lines.push({ desc: desc, qty: 1, unit: '', rate: amt, amount: round2(amt) });
  });
  if (!lines.length) throw new Error('Add at least one item');

  var t = totals(lines, d.discountType, d.discountValue, s, isRep);
  var now = new Date();
  return {
    id: '', created: now, name: clean(c.name), phone: clean(c.phone), email: clean(c.email),
    street: clean(c.street), city: clean(c.city) || 'Frisco', zip: clean(c.zip), state: 'TX',
    lines: t.lines, subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total,
    notes: clean(d.notes, 1500), validUntil: new Date(now.getTime() + s.validDays * 864e5), footer: s.footer, token: '',
    type: isRep ? 'Repurpose' : 'New', origLabor: isRep ? origLabor : 0
  };
}

// Customer's-eye preview: same PDF + email, nothing saved or sent
function previewEstimate(d) {
  var est = buildEst_(d, settings());
  est.id = d.reviseId ? clean(d.reviseId) : 'PREVIEW';
  if (d.reviseId) est.revision = 1;
  if (d.photo && d.photo.length < 12000000) est.photoB64 = d.photo;
  var pdf = estimatePdf(est);
  return { ok: true, total: est.total, year2: year2_(est), name: 'Preview-' + (est.name || 'estimate').replace(/[^\w]+/g, '-') + '.pdf',
    pdf: Utilities.base64Encode(pdf.getBytes()), emailSubject: customerSubject_(est), emailHtml: customerEmailHtml_(est, !!est.photoB64, '#') };
}

function createEstimate(d) {
  var s = settings();
  var est = buildEst_(d, s), isRep = isRep_(est), origLabor = est.origLabor;
  var sh = sheet('Estimates');
  ['Type', 'Original labor', 'Revision', 'Revised at', 'Old tokens'].forEach(function (c) { ensureCol_(sh, c); });
  // Editing an estimate that was already sent: same estimate #, new signing link, old link retired
  var reviseRow = 0, prev = null, ph = headerIndex(sh);
  if (d.reviseId) {
    reviseRow = findRow(clean(d.reviseId));
    if (!reviseRow) throw new Error('Could not find the original estimate ' + clean(d.reviseId) + '.');
    prev = sh.getRange(reviseRow, 1, 1, sh.getLastColumn()).getValues()[0];
    if (prev[ph['Status']] === 'Approved') throw new Error('This estimate is already approved, so it can\u2019t be changed. Create a new estimate instead.');
  }
  var id = reviseRow ? clean(d.reviseId) : 'FCL-' + (1000 + sh.getLastRow());
  var token = Utilities.getUuid().replace(/-/g, '');
  var now = est.created;
  est.id = id; est.token = token;
  if (reviseRow) est.revision = (Number(prev[ph['Revision']]) || 0) + 1;


  var rowVals = [est.id, now, 'Sent', est.name, est.phone, est.email, est.street, est.city, est.zip,
    est.lines.map(function (l) { return l.desc + (l.unit ? ' (' + l.qty + ' ' + l.unit + ')' : '') + ' $' + money(l.amount); }).join('\n'),
    est.subtotal, est.discount, est.tax, est.total, est.notes, '', '', JSON.stringify(est.lines), token];
  var eh = headerIndex(sh); if (eh['Lead #'] !== undefined) rowVals[eh['Lead #']] = clean(d.leadId);
  rowVals[eh['Type']] = est.type; if (isRep) rowVals[eh['Original labor']] = origLabor;
  if (d.photo && d.photo.length < 12000000) {
    est.photoB64 = d.photo;
    if (eh['Preview file'] !== undefined) {
      try { rowVals[eh['Preview file']] = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(d.photo), 'image/jpeg', id + ' - lighting preview.jpg')).getId(); } catch (e) {}
    }
  }
  for (var i = 0; i < rowVals.length; i++) if (rowVals[i] === undefined) rowVals[i] = '';
  if (reviseRow) {
    var full = prev.slice(); while (full.length < sh.getLastColumn()) full.push('');
    for (var j = 0; j < rowVals.length; j++) full[j] = rowVals[j];
    if (!d.leadId && eh['Lead #'] !== undefined) full[eh['Lead #']] = prev[eh['Lead #']] || '';
    if (eh['Signed name'] !== undefined) full[eh['Signed name']] = '';
    if (eh['Signed at'] !== undefined) full[eh['Signed at']] = '';
    full[eh['Revision']] = est.revision; full[eh['Revised at']] = now;
    full[eh['Old tokens']] = [prev[ph['Old tokens']], prev[ph['Token']]].filter(String).join(',');
    sh.getRange(reviseRow, 1, 1, full.length).setValues([full]);
  } else {
    sh.appendRow(rowVals);
  }
  if (d.leadId) { try { setLeadStatus(clean(d.leadId), 'Estimated', id); } catch (e) {} }

  var pdf = estimatePdf(est);
  var photo = null;
  if (d.photo && d.photo.length < 12000000) photo = Utilities.newBlob(Utilities.base64Decode(d.photo), 'image/jpeg', est.id + '-lighting-preview.jpg');

  var emailed = false;
  if (d.approvedOnSite) {
    approveEstimate(id, null, 'Approved on site', est, pdf, photo);
  } else if (validEmail(est.email)) {
    sendCustomerEstimate(est, pdf, photo);
    emailed = true;
  }
  // Copy to the estimates inbox (keeps the main inbox clean)
  MailApp.sendEmail({
    to: settings().estimatesInbox,
    subject: (d.approvedOnSite ? 'Estimate approved on site: ' : (reviseRow ? 'Estimate revised & resent: ' : 'Estimate sent: ')) + (isRep ? '[Repurpose] ' : '') + est.id + ' - ' + est.name + ' - $' + money(est.total),
    htmlBody: '<p>' + (emailed ? 'Sent to ' + esc(est.email) + '.' : (d.approvedOnSite ? 'Marked approved on site.' : '<b>No customer email on file</b> - the PDF is attached so you can text or print it.')) + '</p>' + summaryTable(est),
    attachments: photo ? [pdf, photo] : [pdf]
  });

  return { ok: true, id: id, total: est.total, emailed: emailed, approved: !!d.approvedOnSite, revised: !!reviseRow };
}

function totals(lines, discountType, discountValue, s, noMinimum) {
  lines = lines.slice();
  var subtotal = round2(lines.reduce(function (a, l) { return a + l.amount; }, 0));
  var dv = Math.max(0, Number(discountValue) || 0);
  var discount = discountType === 'pct' ? round2(subtotal * Math.min(dv, 100) / 100) : round2(Math.min(dv, subtotal));
  var after = round2(subtotal - discount);
  if (!noMinimum && s.minimum > 0 && after < s.minimum) {
    var adj = round2(s.minimum - after);
    lines.push({ desc: 'Minimum project adjustment', qty: 1, unit: '', rate: adj, amount: adj });
    subtotal = round2(subtotal + adj); after = s.minimum;
  }
  var tax = round2(after * s.taxRate / 100);
  return { lines: lines, subtotal: subtotal, discount: discount, tax: tax, total: round2(after + tax) };
}

function approveEstimate(id, token, via, est, pdf, photo) {
  var sh = sheet('Estimates'), row = findRow(id);
  if (!row) return { ok: false, error: 'Estimate not found' };
  var h = headerIndex(sh), vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  if (token && token !== vals[h['Token']]) return { ok: false, error: 'This approval link is not valid.' };
  if (vals[h['Status']] === 'Approved') return { ok: true, already: true, id: id, name: vals[h['Customer']] };

  sh.getRange(row, h['Status'] + 1).setValue('Approved');
  sh.getRange(row, h['Approved at'] + 1).setValue(new Date());
  sh.getRange(row, h['Approved via'] + 1).setValue(via);

  est = est || estFromRow(vals, h);
  pdf = pdf || estimatePdf(est);
  var s = settings();
  var att = photo ? [pdf, photo] : [pdf];

  // Office (QuickBooks) email
  MailApp.sendEmail({
    to: s.approvedInbox,
    subject: '\u2705 Approved' + (isRep_(est) ? ' (repurpose)' : '') + ': ' + est.name + ' - $' + money(est.total) + ' - add to QuickBooks (' + est.id + ')',
    htmlBody: officeEmail(est, via),
    attachments: att
  });
  // Customer thank-you
  if (validEmail(est.email)) {
    MailApp.sendEmail({
      to: est.email, name: BRAND.name, replyTo: s.approvedInbox,
      subject: 'You\u2019re on the schedule! Estimate ' + est.id + ' approved',
      htmlBody: wrap('<h2 style="font-family:Georgia,serif;color:' + BRAND.red + ';margin:0 0 10px">Thank you, ' + esc(firstName(est.name)) + '!</h2>' +
        '<p>Your estimate <b>' + est.id + '</b> for <b>$' + money(est.total) + '</b> is approved' + (est.signedName ? ' and signed' : '') + '. ' + (isRep_(est) ? 'Starting next year, you\u2019re back to your locked reinstallation rate of' : 'Your locked rate for Year 2 and beyond is') + ' <b>$' + money(year2_(est)) + '</b> per year. We\u2019ll reach out shortly to schedule your installation.</p><p>Your signed estimate is attached for your records.</p>' +
        '<p>Questions? Call or text <b>' + BRAND.phone + '</b>.</p>'),
      attachments: [pdf]
    });
  }
  return { ok: true, id: id, name: est.name };
}

function signPage(id, token) {
  var sh = sheet('Estimates'), row = findRow(id), err = '', est = null, already = false;
  if (!row) err = 'We couldn\u2019t find that estimate.';
  else {
    var h = headerIndex(sh), v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    if (!token || token !== v[h['Token']]) err = (token && h['Old tokens'] !== undefined && String(v[h['Old tokens']] || '').split(',').indexOf(token) >= 0)
      ? 'This estimate has been updated since this email was sent. Please open the most recent email from us titled \u201cUpdated: \u2026\u201d to review and sign the current version.'
      : 'This link is not valid.';
    else { est = estFromRow(v, h); already = v[h['Status']] === 'Approved'; }
  }
  var css = '*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;background:#FBF7F0;color:#2B201C}' +
    '.band{background:#140D0B;text-align:center;padding:14px;border-bottom:5px solid ' + BRAND.red + '}.band img{height:70px;max-width:100%}' +
    '.wrap{max-width:640px;margin:0 auto;padding:18px 16px 40px}.card{background:#fff;border:1px solid #E6DAC6;border-radius:14px;padding:18px;margin-bottom:14px}' +
    'h1{font-family:Georgia,serif;color:' + BRAND.red + ';font-size:26px;margin:4px 0 6px}h2{font-family:Georgia,serif;color:' + BRAND.red + ';font-size:19px;margin:0 0 10px}' +
    '.muted{color:#6E615A;font-size:14px}table{width:100%;border-collapse:collapse;font-size:15px}td{padding:8px 4px;border-bottom:1px solid #E6DAC6}td.r{text-align:right;white-space:nowrap}' +
    '.yr{display:flex;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid #E6DAC6}.yr b{font-size:20px;color:' + BRAND.red + '}.yr:last-child{border:0}' +
    '.terms{max-height:260px;overflow:auto;font-size:13.5px;line-height:1.5;background:#FBF7F0;border-radius:10px;padding:12px 14px}.terms p{margin:0 0 10px}' +
    'label.f{display:block;font-weight:bold;margin:14px 0 6px}input[type=text]{width:100%;font-size:18px;padding:12px;border:1.5px solid #D9CDB2;border-radius:10px;font-family:Georgia,serif}' +
    '.chk{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:15px}.chk input{width:22px;height:22px;flex:none;margin-top:1px}' +
    'button{width:100%;margin-top:16px;border:0;border-radius:12px;padding:16px;font-size:17px;font-weight:bold;background:' + BRAND.red + ';color:#fff}button:disabled{opacity:.5}' +
    '.err{color:' + BRAND.red + ';font-weight:bold;margin-top:10px}.done{text-align:center}.sig{font-family:Georgia,serif;font-size:24px;font-style:italic}';
  var body;
  if (err) body = '<div class="card done"><h1>Something went wrong</h1><p>' + esc(err) + '</p><p>Please call or text <b>' + BRAND.phone + '</b> and we\u2019ll take care of it.</p></div>';
  else if (already) body = '<div class="card done"><h1>Already approved</h1><p>Estimate <b>' + esc(est.id) + '</b> was approved' + (est.signedName ? ' and signed by <b>' + esc(est.signedName) + '</b>' : '') + '. We\u2019ll be in touch to schedule your installation.</p><p class="muted">Questions? Call or text ' + BRAND.phone + '.</p></div>';
  else {
    var rows = est.lines.map(function (l) { return '<tr><td>' + esc(l.desc) + (l.unit ? ' <span class="muted">(' + l.qty + ' ' + l.unit + ')</span>' : '') + '</td><td class="r">$' + money(l.amount) + '</td></tr>'; }).join('');
    var L = labels_(est);
    var terms = terms_(est).map(function (t, i) { return '<p><b>' + (i + 1) + '. ' + t[0] + '.</b> ' + esc(t[1]) + '</p>'; }).join('') + '<p><i>' + TERMS_CLOSE + '</i></p>';
    body = '<div id="form"><div class="card"><div class="muted">Estimate ' + esc(est.id) + '</div><h1>Review &amp; sign</h1>' +
      '<p class="muted" style="margin:0">' + esc(est.name) + ' \u2022 ' + esc(est.street) + (est.city ? ', ' + esc(est.city) : '') + '</p></div>' +
      '<div class="card"><h2>Your holiday lighting</h2><table>' + rows + '</table></div>' +
      '<div class="card"><h2>Your pricing</h2><div class="yr"><span>' + L[0] + '<br><span class="muted">' + L[1] + '</span></span><b>$' + money(est.total) + '</b></div>' +
      '<div class="yr"><span>' + L[2] + '<br><span class="muted">' + L[3] + '</span></span><b>$' + money(year2_(est)) + '<span class="muted" style="font-size:13px"> /yr</span></b></div></div>' +
      '<div class="card"><h2>' + aboutTitle_(est) + '</h2><div style="margin:0;line-height:1.55">' + aboutHtml_(est) + '</div></div>' +
      '<div class="card"><h2>Terms and Conditions</h2><div class="terms">' + terms + '</div>' +
      '<label class="f" for="nm">Type your full name to sign</label><input type="text" id="nm" autocomplete="name" placeholder="Full name">' +
      '<label class="chk"><input type="checkbox" id="ag"> <span>I have read and agree to the Terms and Conditions above.</span></label>' +
      '<button id="go">Sign &amp; Approve</button><div class="err" id="er"></div></div></div>' +
      '<div id="ok" class="card done" style="display:none"><h1>Thank you!</h1><p>Your estimate is signed and approved. We\u2019ll reach out shortly to schedule your installation.</p>' +
      '<p class="sig" id="sg"></p><p class="muted">A signed copy has been emailed to you. Questions? Call or text ' + BRAND.phone + '.</p></div>' +
      '<script>var b=document.getElementById("go"),n=document.getElementById("nm"),a=document.getElementById("ag"),e=document.getElementById("er");' +
      'b.onclick=function(){e.textContent="";var v=n.value.trim();if(v.split(/\\s+/).length<2){e.textContent="Please type your full name (first and last).";return;}' +
      'if(!a.checked){e.textContent="Please check the box to agree to the terms.";return;}b.disabled=true;b.textContent="Signing...";' +
      'google.script.run.withSuccessHandler(function(r){if(r&&r.ok){document.getElementById("form").style.display="none";document.getElementById("sg").textContent=v;document.getElementById("ok").style.display="block";window.scrollTo(0,0);}' +
      'else{b.disabled=false;b.textContent="Sign & Approve";e.textContent=(r&&r.error)||"Something went wrong. Please try again.";}})' +
      '.withFailureHandler(function(){b.disabled=false;b.textContent="Sign & Approve";e.textContent="Something went wrong. Please try again or call ' + BRAND.phone + '.";})' +
      '.signEstimate(' + JSON.stringify(String(id)) + ',' + JSON.stringify(String(token)) + ',v,true);};</script>';
  }
  var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body>' +
    '<div class="band"><img src="' + BRAND.logo + '" alt="Frisco Christmas Lights"></div><div class="wrap">' + body + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Sign your estimate \u2022 ' + BRAND.name).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function signEstimate(id, token, name, agreed) {
  name = clean(name, 120);
  if (!agreed) return { ok: false, error: 'Please agree to the terms.' };
  if (name.split(/\s+/).length < 2) return { ok: false, error: 'Please type your full name.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet('Estimates'), row = findRow(id); if (!row) return { ok: false, error: 'Estimate not found.' };
    var h = headerIndex(sh), v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    if (token !== v[h['Token']]) return { ok: false, error: 'This link is not valid.' };
    if (v[h['Status']] === 'Approved') return { ok: true, already: true };
    var now = new Date();
    sh.getRange(row, ensureCol_(sh, 'Signed name') + 1).setValue(name);
    sh.getRange(row, ensureCol_(sh, 'Signed at') + 1).setValue(now);
    v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0]; h = headerIndex(sh);
    var est = estFromRow(v, h);
    return approveEstimate(id, token, 'Signed online by ' + name, est);
  } finally { lock.releaseLock(); }
}

/* ======================= EMAILS & PDF ======================= */
function customerSubject_(est) { return (est.revision ? 'Updated: ' : '') + (isRep_(est) ? 'Your light repurpose estimate ' : 'Your Christmas lighting estimate ') + est.id + ' - $' + money(est.total); }
function sendCustomerEstimate(est, pdf, photo) {
  var url = ScriptApp.getService().getUrl() + '?a=approve&id=' + encodeURIComponent(est.id) + '&t=' + est.token;
  MailApp.sendEmail({ to: est.email, name: BRAND.name, replyTo: settings().estimatesInbox,
    subject: customerSubject_(est),
    htmlBody: customerEmailHtml_(est, !!photo, url), attachments: photo ? [pdf, photo] : [pdf] });
}
function customerEmailHtml_(est, hasPhoto, url) {
  var photo = hasPhoto;
  return wrap(
    '<h2 style="font-family:Georgia,serif;color:' + BRAND.red + ';margin:0 0 10px">' + (isRep_(est) ? 'Moving your lights to your new home' : 'Your lighting estimate') + '</h2>' +
    '<p>Hi ' + esc(firstName(est.name)) + ',</p>' + (est.revision ? '<p style="background:#FFF4DC;border-radius:8px;padding:10px 14px;margin:0 0 12px"><b>Updated estimate.</b> We\u2019ve made the changes you asked for. This replaces the earlier version, so please use the button in this email to review and sign.</p>' : '') + '<p>' + (isRep_(est) ? 'Congratulations on the new home! Here\u2019s your estimate to move your lights to <b>' + esc(est.street) + '</b>.' : 'Thanks for choosing ' + BRAND.name + '! Here\u2019s your estimate for <b>' + esc(est.street) + '</b>.') +
    (photo ? ' We\u2019ve also attached a preview showing where your lights will go.' : '') + '</p>' +
    summaryTable(est) + yearBox_(est) +
    (est.notes ? '<p style="background:#FBF7F0;border-left:3px solid ' + BRAND.gold + ';padding:10px 14px">' + esc(est.notes).replace(/\n/g, '<br>') + '</p>' : '') +
    '<h3 style="font-family:Georgia,serif;color:' + BRAND.red + ';margin:22px 0 6px">' + aboutTitle_(est) + '</h3><div style="line-height:1.55">' + aboutHtml_(est) + '</div>' +
    '<p style="text-align:center;margin:28px 0"><a href="' + url + '" style="background:' + BRAND.red + ';color:#fff;text-decoration:none;font-weight:bold;padding:15px 30px;border-radius:10px;display:inline-block;font-size:16px">Review &amp; sign estimate</a></p>' +
    '<p style="color:#6E615A;font-size:13px">Valid until ' + fmtDate(est.validUntil) + '. The full estimate and Terms and Conditions are attached as a PDF.</p>' +
    '<p>Questions or changes? Just reply to this email or call/text <b>' + BRAND.phone + '</b>.</p>'
  );
}

function officeEmail(est, via) {
  var row = function (k, v) { return '<tr><td style="padding:6px 12px 6px 0;color:#6E615A;white-space:nowrap">' + k + '</td><td style="padding:6px 0;font-weight:bold">' + esc(v || '-') + '</td></tr>'; };
  return wrap(
    '<h2 style="font-family:Georgia,serif;color:' + BRAND.red + ';margin:0 0 6px">' + (isRep_(est) ? 'Approved repurpose (customer moved)' : 'New approved install') + '</h2>' +
    '<p style="margin:0 0 16px;color:#6E615A">' + esc(via) + ' \u2022 ' + est.id + (est.signedAt ? ' \u2022 ' + fmtDateTime_(est.signedAt) : '') + '</p>' +
    '<h3 style="margin:18px 0 6px">Customer (QuickBooks fields)</h3><table style="border-collapse:collapse;font-size:15px">' +
    row('Display name', est.name) + row('First name', firstName(est.name)) + row('Last name', lastName(est.name)) +
    row('Email', est.email) + row('Phone', est.phone) + row('Street', est.street) + row('City', est.city) +
    row('State', est.state || 'TX') + row('ZIP', est.zip) + '</table>' +
    '<h3 style="margin:22px 0 6px">Products / services</h3>' + summaryTable(est) + yearBox_(est) +
    (est.notes ? '<p><b>Notes:</b> ' + esc(est.notes) + '</p>' : '') +
    '<p style="color:#6E615A;font-size:13px">The estimate PDF is attached. Everything is also logged in the Estimates sheet.</p>');
}

function yearBox_(est) {
  var r = function (k, sub, v) { return '<tr><td style="padding:8px 0;border-bottom:1px solid #E6DAC6">' + k + '<br><span style="color:#6E615A;font-size:12px">' + sub + '</span></td><td style="padding:8px 0;border-bottom:1px solid #E6DAC6;text-align:right;font-weight:bold;font-size:17px;color:' + BRAND.red + ';white-space:nowrap">' + v + '</td></tr>'; };
  var L = labels_(est);
  return '<table style="width:100%;border-collapse:collapse;margin:6px 0 10px">' + r('<b>' + L[0] + '</b>', L[1], '$' + money(est.total)) +
    r('<b>' + L[2] + '</b>', L[3], '$' + money(year2_(est)) + ' /yr') + '</table>';
}

function summaryTable(est) {
  var td = 'padding:8px 6px;border-bottom:1px solid #E6DAC6;';
  var rows = est.lines.map(function (l) {
    return '<tr><td style="' + td + '">' + esc(l.desc) + (l.unit ? '<br><span style="color:#6E615A;font-size:12px">' + l.qty + ' ' + l.unit + ' \u00d7 $' + money(l.rate) + '</span>' : '') +
      '</td><td style="' + td + 'text-align:right;white-space:nowrap">$' + money(l.amount) + '</td></tr>';
  }).join('');
  var tot = function (k, v, b) { return '<tr><td style="padding:6px;text-align:right;' + (b ? 'font-weight:bold;font-size:17px' : 'color:#6E615A') + '">' + k + '</td><td style="padding:6px;text-align:right;white-space:nowrap;' + (b ? 'font-weight:bold;font-size:17px;color:' + BRAND.red : '') + '">' + v + '</td></tr>'; };
  return '<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">' + rows +
    (est.discount ? tot('Subtotal', '$' + money(est.subtotal)) + tot('Discount', '-$' + money(est.discount)) : '') +
    (est.tax ? tot('Tax', '$' + money(est.tax)) : '') + tot('Total', '$' + money(est.total), true) + '</table>';
}

function logoDataUri_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('logo64');
  if (hit) return 'data:image/jpeg;base64,' + hit;
  try {
    var r = UrlFetchApp.fetch(BRAND.logo, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return '';
    var b64 = Utilities.base64Encode(r.getBlob().getBytes());
    if (b64.length < 100000) cache.put('logo64', b64, 21600);
    return 'data:image/jpeg;base64,' + b64;
  } catch (e) { return ''; }
}

function bulbRow_(n) {
  var c = ['#D21F2C', '#1E9E4A', '#E8B23A', '#2F6FD6', '#D21F2C', '#1E9E4A', '#E8B23A'], out = '';
  for (var i = 0; i < n; i++) out += '<span style="color:' + c[i % c.length] + ';font-size:15px;letter-spacing:9px">&#9679;</span>';
  return out;
}

function jpegSize_(bytes) {
  var i = 2, n = bytes.length, B = function (k) { return bytes[k] & 255; };
  while (i + 9 < n) {
    if (B(i) !== 0xFF) { i++; continue; }
    var m = B(i + 1), len = (B(i + 2) << 8) | B(i + 3);
    if (m >= 0xC0 && m <= 0xC3) return { h: (B(i + 5) << 8) | B(i + 6), w: (B(i + 7) << 8) | B(i + 8) };
    i += 2 + len;
  }
  return null;
}

function estimatePdf(est) {
  var W = 680, line = '#E6DAC6', gold = BRAND.gold, red = BRAND.red, muted = '#6E615A', L = labels_(est);
  var cell = function (txt, st) { return '<td style="' + st + '">' + txt + '</td>'; };
  var rows = est.lines.map(function (l) {
    var b = 'padding:9px 8px;border-bottom:1px solid ' + line + ';font-size:12.5px;';
    return '<tr>' + cell('<b>' + esc(l.desc) + '</b>', b) + cell(l.unit ? l.qty + ' ' + l.unit : '', b + 'text-align:center;color:' + muted) +
      cell(l.unit ? '$' + money(l.rate) : '', b + 'text-align:right;color:' + muted) + cell('<b>$' + money(l.amount) + '</b>', b + 'text-align:right') + '</tr>';
  }).join('');
  var sub = function (k, v) { return '<tr><td colspan="3" style="padding:5px 8px;text-align:right;font-size:12px;color:' + muted + '">' + k + '</td><td style="padding:5px 8px;text-align:right;font-size:12px">' + v + '</td></tr>'; };
  var included = String(est.footer || '').replace(/^Price includes\s*/i, '').replace(/\.$/, '').split(/,\s*(?:and\s+)?|\s+and\s+/).filter(String);
  var incl = included.map(function (x) { return '<span style="font-size:11.5px;margin-right:16px"><span style="color:' + red + ';font-weight:bold">&#10003;</span> ' + esc(x.charAt(0).toUpperCase() + x.slice(1)) + '</span>'; }).join('');
  var label = function (t) { return '<div style="font-size:10px;letter-spacing:2px;color:' + gold + ';font-weight:bold">' + t + '</div>'; };
  var heading = function (t) { return '<div style="font-family:Georgia,serif;font-size:17px;color:' + red + ';margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid ' + gold + '">' + t + '</div>'; };

  var preview = '';
  if (est.photoB64) {
    var size = null; try { size = jpegSize_(Utilities.base64Decode(est.photoB64)); } catch (e) {}
    var ph = size && size.w ? Math.round(W * size.h / size.w) : Math.round(W * 0.75);
    if (ph > 760) ph = 760;
    var pw = size && size.w ? Math.round(ph * size.w / size.h) : W; if (pw > W) pw = W;
    preview = '<div style="page-break-inside:avoid">' + heading('Your lighting preview') +
      '<div style="text-align:center"><img src="data:image/jpeg;base64,' + est.photoB64 + '" width="' + pw + '" height="' + ph + '" style="width:' + pw + 'px;height:' + ph + 'px"></div></div>';
  }

  var html = '<html><body style="font-family:Helvetica,Arial,sans-serif;color:#2B201C;margin:0">' +
    '<img src="data:image/jpeg;base64,' + PDF_BANNER + '" width="' + W + '" height="' + Math.round(W * 250 / 1360) + '" style="width:' + W + 'px;height:' + Math.round(W * 250 / 1360) + 'px">' +

    '<table style="width:' + W + 'px;border-collapse:collapse;margin-top:16px"><tr>' +
    '<td style="vertical-align:bottom"><div style="font-family:Georgia,serif;font-size:28px;color:' + red + ';letter-spacing:2px">' + (isRep_(est) ? 'REPURPOSE ESTIMATE' : 'ESTIMATE') + '</div>' +
    '<div style="font-size:12px;color:' + muted + '">No. <b style="color:#2B201C">' + est.id + '</b></div></td>' +
    '<td style="vertical-align:bottom;text-align:right;font-size:12px;color:' + muted + ';line-height:1.6">Date: <b style="color:#2B201C">' + fmtDate(est.created) + '</b><br>Valid until: <b style="color:#2B201C">' + fmtDate(est.validUntil) + '</b></td>' +
    '</tr></table>' +

    '<table style="width:' + W + 'px;border-collapse:collapse;margin-top:16px"><tr>' +
    '<td style="width:60%;vertical-align:top;border-left:4px solid ' + gold + ';padding:4px 14px">' + label('PREPARED FOR') +
    '<div style="font-family:Georgia,serif;font-size:19px;color:' + red + ';margin-top:3px">' + esc(est.name) + '</div>' +
    '<div style="font-size:12px;line-height:1.55">' + esc(est.street) + (est.city ? ', ' + esc(est.city) : '') + ', TX ' + esc(est.zip) + '<br>' + esc(est.phone) + (est.email ? ' &nbsp;\u2022&nbsp; ' + esc(est.email) : '') + '</div></td>' +
    '<td style="vertical-align:top;border-left:4px solid ' + red + ';padding:4px 14px">' + label('FROM') +
    '<div style="font-size:12px;line-height:1.55;margin-top:3px"><b>' + BRAND.legal + '</b><br>' + BRAND.phone + '<br>' + BRAND.email + '<br>friscolights.com</div></td>' +
    '</tr></table>' +

    heading(isRep_(est) ? 'Moving your lights to your new home' : 'Your holiday lighting') +
    '<table style="width:' + W + 'px;border-collapse:collapse"><tr>' +
    '<td style="padding:6px 8px;font-size:10px;letter-spacing:1px;font-weight:bold;color:' + gold + ';border-bottom:1px solid ' + gold + '">DESCRIPTION</td>' +
    '<td style="padding:6px 8px;font-size:10px;letter-spacing:1px;font-weight:bold;color:' + gold + ';text-align:center;border-bottom:1px solid ' + gold + '">QTY</td>' +
    '<td style="padding:6px 8px;font-size:10px;letter-spacing:1px;font-weight:bold;color:' + gold + ';text-align:right;border-bottom:1px solid ' + gold + '">RATE</td>' +
    '<td style="padding:6px 8px;font-size:10px;letter-spacing:1px;font-weight:bold;color:' + gold + ';text-align:right;border-bottom:1px solid ' + gold + '">AMOUNT</td></tr>' +
    rows +
    (est.discount ? sub('Subtotal', '$' + money(est.subtotal)) + sub('Discount', '-$' + money(est.discount)) : '') +
    (est.tax ? sub('Tax', '$' + money(est.tax)) : '') +
    '<tr><td colspan="3" style="padding:12px 8px;text-align:right;font-family:Georgia,serif;font-size:18px;color:#2B201C;border-top:3px solid ' + red + '">Total</td>' +
    '<td style="padding:12px 8px;text-align:right;font-size:20px;font-weight:bold;color:' + red + ';border-top:3px solid ' + red + '">$' + money(est.total) + '</td></tr></table>' +

    (incl ? '<div style="margin-top:8px">' + incl + '</div>' : '') +

    heading('Your pricing') +
    '<table style="width:' + W + 'px;border-collapse:collapse">' +
    '<tr><td style="padding:8px;border-bottom:1px solid ' + line + '"><b style="font-size:14px">' + L[0] + '</b><br><span style="font-size:11px;color:' + muted + '">' + L[1] + '</span></td>' +
    '<td style="padding:8px;border-bottom:1px solid ' + line + ';text-align:right;font-size:18px;font-weight:bold;color:' + red + '">$' + money(est.total) + '</td></tr>' +
    '<tr><td style="padding:8px"><b style="font-size:14px">' + L[2] + '</b><br><span style="font-size:11px;color:' + muted + '">' + L[3] + '</span></td>' +
    '<td style="padding:8px;text-align:right;font-size:18px;font-weight:bold;color:' + red + '">$' + money(year2_(est)) + '<span style="font-size:11px;color:' + muted + ';font-weight:normal"> per year</span></td></tr></table>' +
    '<div style="font-size:11px;color:' + muted + ';font-style:italic;margin-top:2px">' + L[4] + '</div>' +

    heading(aboutTitle_(est)) + '<div style="font-size:12px;line-height:1.6">' + aboutHtml_(est, '12px') + '</div>' +
    (est.notes ? heading('Notes') + '<div style="font-size:12px;line-height:1.55">' + esc(est.notes) + '</div>' : '') +
    preview +

    '<div style="page-break-inside:avoid">' + heading('Terms and Conditions') +
    terms_(est).map(function (t, i) { return '<div style="font-size:10.5px;line-height:1.55;margin-bottom:6px"><b>' + (i + 1) + '. ' + t[0] + '.</b> ' + esc(t[1]) + '</div>'; }).join('') +
    '<div style="font-size:10.5px;font-style:italic;margin-top:4px">' + TERMS_CLOSE + '</div></div>' +

    (est.signedName
      ? '<table style="width:' + W + 'px;border-collapse:collapse;margin-top:18px;page-break-inside:avoid"><tr><td style="border-left:4px solid ' + red + ';padding:6px 14px">' +
        '<div style="font-size:10px;letter-spacing:2px;color:' + gold + ';font-weight:bold">ACCEPTED AND SIGNED ELECTRONICALLY</div>' +
        '<div style="font-family:Georgia,serif;font-style:italic;font-size:22px;margin:4px 0;border-bottom:1px solid #2B201C;padding-bottom:2px">' + esc(est.signedName) + '</div>' +
        '<div style="font-size:11px;color:' + muted + '">Signed by <b style="color:#2B201C">' + esc(est.signedName) + '</b> on ' + (est.signedAt ? fmtDateTime_(est.signedAt) : '') + ' \u2022 Estimate ' + est.id + '</div></td></tr></table>'
      : '<table style="width:' + W + 'px;border-collapse:collapse;margin-top:18px"><tr><td style="border-left:4px solid ' + gold + ';padding:6px 14px;font-size:11.5px">' +
        '<b>To approve:</b> tap <b>Review &amp; sign estimate</b> in your email to sign online, or call/text ' + BRAND.phone + '.</td></tr></table>') +

    '<div style="text-align:center;margin-top:26px;border-top:1px solid ' + line + ';padding-top:14px">' +
    '<div style="font-family:Georgia,serif;font-style:italic;font-size:18px;color:' + red + '">Thank you for choosing Frisco Christmas Lights!</div>' +
    '<div style="font-size:11px;color:' + muted + ';margin-top:6px">' + BRAND.legal + ' \u2022 ' + BRAND.phone + ' \u2022 friscolights.com</div></div>' +
    '</body></html>';
  return Utilities.newBlob(html, 'text/html', est.id + '.html').getAs('application/pdf').setName('Frisco-Christmas-Lights-' + est.id + '.pdf');
}

function wrap(inner) {
  return '<div style="background:#FBF7F0;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#2B201C">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border-bottom:5px solid ' + BRAND.red + ';padding:26px 24px">' +
    '<div style="background:#140D0B;margin:-26px -24px 18px;padding:14px 20px;border-radius:0;text-align:center"><img src="' + BRAND.logo + '" alt="Frisco Christmas Lights" style="height:64px;max-width:100%"></div>' + inner +
    '<p style="margin-top:26px;font-size:12px;color:#6E615A">' + BRAND.legal + ' \u2022 ' + BRAND.phone + ' \u2022 <a href="' + BRAND.site + '" style="color:' + BRAND.red + '">friscolights.com</a></p></div></div>';
}

/* ======================= DATA HELPERS ======================= */
function ss_() {
  var id = PROPS.getProperty('SHEET_ID');
  if (!id) throw new Error('Run setup first (choose "setup" and click Run in the Apps Script editor).');
  return SpreadsheetApp.openById(id);
}
function sheet(name) { var s = ss_().getSheetByName(name); if (!s) throw new Error('Missing tab: ' + name + ' (run setup)'); return s; }
function ensureCol_(sh, name) { var h = headerIndex(sh); if (h[name] === undefined) { sh.getRange(1, sh.getLastColumn() + 1).setValue(name).setFontWeight('bold'); h = headerIndex(sh); } return h[name]; }
function headerIndex(sh) { var h = {}; sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (k, i) { h[k] = i; }); return h; }

function settings() {
  var v = {}; sheet('Settings').getDataRange().getValues().slice(1).forEach(function (r) { v[String(r[0]).trim()] = r[1]; });
  return {
    pin: String(v['App PIN'] || '').trim(),
    estimatesInbox: pickEmail(v['Estimates inbox'], v['Office email']),
    approvedInbox: pickEmail(v['Approved jobs inbox'], BRAND.email),
    minimum: Number(v['Minimum project']) || 0,
    taxRate: Number(v['Tax rate %']) || 0,
    validDays: Number(v['Estimate valid (days)']) || 30,
    footer: String(v['Footer note'] || ''),
    repurposeRate: v['Repurpose rate per ft'] === undefined || v['Repurpose rate per ft'] === '' ? 1 : Number(v['Repurpose rate per ft']) || 0
  };
}
function pickEmail(a, b) { a = String(a || '').trim(); b = String(b || '').trim(); return validEmail(a) ? a : (validEmail(b) ? b : Session.getEffectiveUser().getEmail()); }
function publicSettings() { var s = settings(); return { minimum: s.minimum, taxRate: s.taxRate, repurposeRate: s.repurposeRate }; }
function requirePin(pin) {
  var s = settings();
  if (!s.pin || String(pin || '').trim() !== s.pin) { Utilities.sleep(800); throw new Error('Wrong PIN'); }
}
function getPrices() {
  return sheet('Prices').getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] && String(r[3] || 'Y').toUpperCase().charAt(0) !== 'N'; })
    .map(function (r) { return { item: String(r[0]).trim(), unit: String(r[1] || 'each').trim(), price: Number(r[2]) || 0 }; });
}
function findRow(id) {
  var sh = sheet('Estimates'), ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = ids.length - 1; i >= 1; i--) if (ids[i][0] === id) return i + 1;
  return 0;
}
function estFromRow(v, h) {
  var s = settings(), created = v[h['Created']] instanceof Date ? v[h['Created']] : new Date();
  return { id: v[h['Estimate #']], created: created, name: v[h['Customer']], phone: String(v[h['Phone']]), email: v[h['Email']],
    street: v[h['Street']], city: v[h['City']], zip: String(v[h['ZIP']]), state: 'TX',
    lines: JSON.parse(v[h['Items JSON']] || '[]'), subtotal: Number(v[h['Subtotal']]) || 0, discount: Number(v[h['Discount']]) || 0,
    tax: Number(v[h['Tax']]) || 0, total: Number(v[h['Total']]) || 0, notes: v[h['Notes']],
    validUntil: new Date(created.getTime() + s.validDays * 864e5), footer: s.footer, token: v[h['Token']],
    type: h['Type'] !== undefined ? String(v[h['Type']] || 'New') : 'New', origLabor: h['Original labor'] !== undefined ? Number(v[h['Original labor']]) || 0 : 0,
    signedName: h['Signed name'] !== undefined ? v[h['Signed name']] : '', signedAt: h['Signed at'] !== undefined && v[h['Signed at']] instanceof Date ? v[h['Signed at']] : null,
    photoB64: (function () { try { return h['Preview file'] !== undefined && v[h['Preview file']] ? Utilities.base64Encode(DriveApp.getFileById(v[h['Preview file']]).getBlob().getBytes()) : ''; } catch (e) { return ''; } })() };
}
function estimateDetail(id, withPhoto) {
  var sh = sheet('Estimates'), row = findRow(id); if (!row) return { ok: false, error: 'Estimate not found' };
  var h = headerIndex(sh), v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var created = v[h['Created']] instanceof Date ? v[h['Created']] : null, appr = v[h['Approved at']] instanceof Date ? v[h['Approved at']] : null;
  var signedAt = h['Signed at'] !== undefined && v[h['Signed at']] instanceof Date ? v[h['Signed at']] : null;
  var total = Number(v[h['Total']]) || 0;
  var type = h['Type'] !== undefined ? String(v[h['Type']] || 'New') : 'New', origLabor = h['Original labor'] !== undefined ? Number(v[h['Original labor']]) || 0 : 0;
  return { ok: true, est: { type: type, origLabor: origLabor,
    id: v[h['Estimate #']], status: v[h['Status']], created: created ? fmtDate(created) : '',
    name: v[h['Customer']], phone: String(v[h['Phone']] || ''), email: v[h['Email']] || '',
    street: v[h['Street']], city: v[h['City']], zip: String(v[h['ZIP']] || ''),
    lines: JSON.parse(v[h['Items JSON']] || '[]'), subtotal: Number(v[h['Subtotal']]) || 0, discount: Number(v[h['Discount']]) || 0,
    tax: Number(v[h['Tax']]) || 0, total: total, year2: year2_({ type: type, origLabor: origLabor, total: total }), notes: v[h['Notes']] || '',
    approvedAt: appr ? fmtDateTime_(appr) : '', approvedVia: v[h['Approved via']] || '',
    signedName: h['Signed name'] !== undefined ? (v[h['Signed name']] || '') : '', signedAt: signedAt ? fmtDateTime_(signedAt) : '',
    hasPreview: h['Preview file'] !== undefined && !!v[h['Preview file']],
    leadId: h['Lead #'] !== undefined ? String(v[h['Lead #']] || '') : '',
    revision: h['Revision'] !== undefined ? Number(v[h['Revision']]) || 0 : 0,
    photo: withPhoto && h['Preview file'] !== undefined && v[h['Preview file']] ? (function () { try { return Utilities.base64Encode(DriveApp.getFileById(v[h['Preview file']]).getBlob().getBytes()); } catch (e) { return ''; } })() : '' } };
}

function estimatePdfData(id) {
  var sh = sheet('Estimates'), row = findRow(id); if (!row) return { ok: false, error: 'Estimate not found' };
  var h = headerIndex(sh), v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var pdf = estimatePdf(estFromRow(v, h));
  return { ok: true, name: pdf.getName(), pdf: Utilities.base64Encode(pdf.getBytes()) };
}

function recentEstimates(n) {
  var sh = sheet('Estimates'), last = sh.getLastRow(); if (last < 2) return [];
  var h = headerIndex(sh), start = Math.max(2, last - n + 1);
  return sh.getRange(start, 1, last - start + 1, sh.getLastColumn()).getValues().reverse().map(function (r) {
    return { id: r[h['Estimate #']], date: r[h['Created']] instanceof Date ? fmtDate(r[h['Created']]) : '', name: r[h['Customer']],
      street: r[h['Street']], city: r[h['City']] || '', total: Number(r[h['Total']]) || 0, status: r[h['Status']],
      type: h['Type'] !== undefined ? String(r[h['Type']] || 'New') : 'New' };
  });
}

/* ======================= SMALL UTILS ======================= */
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function text(t) { return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.TEXT); }
function clean(v, n) { return String(v == null ? '' : v).trim().substring(0, n || 200); }
function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money(n) { return (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtDateTime_(d) { return Utilities.formatDate(d, 'America/Chicago', "MMM d, yyyy 'at' h:mm a 'CT'"); }
function fmtDate(d) { return Utilities.formatDate(d, 'America/Chicago', 'MMM d, yyyy'); }
function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
function lastName(n) { var p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : ''; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

/* Branded banner at the top of every estimate PDF */
var PDF_BANNER = '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29LK8fhlA/DtueYbYG619ht987KSS0gV1uB9lsow7Hhg437u7OFmwWWGldBXtlEpqmdoznbhzWZIGR3dDnHVWLrayXizGmubLc+hpKqljdO1jsxOf8G/hOMefeq+WJzfkdvgv0jQhTh2slrVL2Ttutx+xXdy5a6oDr3piokMTADNSucxwb0Ad1H5/mo2+xU8r3y07a8UuTjLI3OHl+MZ/JTuDXt90xWN9iCrhIy0zNIeR4F7cE/E5W9i4428yh9TomglmwP4pfGXZ79zHlS6VRyjdM57Seip4Wo4Qeq18el9hUc9yfa6mOmtdG6nAj/iuqAHukOc87vAdAG9BjvO6mMlIzUdlZe5JTPPQuaJaY7RmPGCQB3Zxnp1K2Wpqm266uDbpaoJaKs7Psaqjl5SJItyHRlvUt6kYBwTjOFncMNEXeK7zUjpHUMFQOy7aWPmHI8bODT1G46hRq2Op08qjsynlo2tWmpQza3kc4w1npdyo7RRNay22uFoY1rQA+V7Wue//laPJqrSSJzDuF0lqzhswTS0kEz5LrTARyB+C2pwBgsIGziMeyfhlUlfbU6nkeC3GDhecLpGNWTg9qyfqWdXDSppXIsi9JWcjivNWqdyMERFkBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQH63qFItPwiSdgPeVHW7OCkFhqBDMx22yjYq+o7HuntOt+FX+jadsdF2Yy58spBGP5tirQr6+F0b4I3jm/CTlUHoXVXLaaTlY/EVNKwvjaMhxcMbuIa3bmJJ8WrKuXEKmtNte1ktNU1L3D+Cx7nho7+0k2Dj5NGPPx4CE8ZSlVo01/N5vyzyRZTpQkoybtY/eLlxo6G1ujidkz5EX+8OjpD5dWj4k9y5mvVT2krjlSbWuqam81ks9VMZJHfkB3ADuA8FA55S9xK6bQuju6UkmRsRW12fkY5nKd8NaWB11nq6vlMVJTSS8p6Odgho/PCgsHVTjRUU1S2ppqVpdLMWN67Yyev6bq0xctWDL39O0o1MTFSdv9HUPCSmtuntDG+ymPnla7le7q49+PiR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nOqLLTz0zqiOMNmaefmaOpXMnG+w/u+/SSsaOxqmCduB3n8X67/NdKm+MqKR8DnNEpblnnhUfxql7eyWmV+C8mZo+AI71phjaFXSEauEVlJZ7rPO+XQxGFRUXGpuOaLhHyvKwls7t/rXLWLvaTvFFbLaERFtMBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBZNPMWFYyLy1dWCdiQQXmWKPka88vhleNRdZJOryVpslMrSsNBO9j32jPeed0h3K8Mr8Rb0kth4uesbsFbmy3ea2Tukgc4FzSxwDiMg92y0QK+g8ha501NWZMw2LlQd4skV0vtTcH81RK522NyT+ZO5Wmmm5j1WMXlfJOViFJRN1fSFSrtZYPCW7S01+FHAQ2oqHMkpnF3LiePLmDfb2t2/MLoP/tU0ZqGFlNr20TUVyp8se18Ti0+OCCHAHwP5rj+nnkpp45oXcssbg9rsZwQcgqzqXjRd5IOS/Wex3qYdKiqpuWT58hAP5LRVwim21v2p5rI0RxbSV92xp2ZedLxN0BYXFukdPPqKs7NMVOGE/wDEcu/RaPWGvdS3OmP73q49N26UbU8QJqZW/wCHPN8zgKpKvivf60uitcVuskDtuW30wY/H+M5d+WFk6Jt01+1BSwzvfNNUSAvfI4uLvMk9VDr0XCNm8uCyXy2lRpHSboRcoLPi838yU11rtFfpuqhsxDa54jja6qH+kSyvd7LAB08Seg+KiPEPR9yo6+js1FVT3OOnjEYBaA5oH48dNs58ei6N4U6RohVVFdLC2ZrJP4bpG9cE4P8AmoHxVjfHrl09uYyKnidkiM4BA65+O61uc8NRjV2XfyzOOlpDE9nDFya/c3a++yefpcq7TXq/aaiS96kt8lYwtbHbaIxgFzG/ilcHbAE7DPXBUa1pebdcL3UVVopHQ0khLmwVETMxZ/laW9W+GVtdasIuNQZCOckHGfw5AOPlnCglT+IqxwzUoo6XAKNWCbRI9NXehbWsNVpuz1UTMvlM1RND7PiCJO7wAJPgVYOpNQcOInBtptDax7BgdjByMJ/x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';
