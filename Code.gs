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
  red: '#A2021F', gold: '#AC893E', ink: '#2B201C'
};
var PROPS = PropertiesService.getScriptProperties();
var LEAD_HEADERS = ['Lead #', 'Received', 'Status', 'Name', 'Phone', 'Email', 'Address', 'Street', 'City', 'ZIP',
  'Property type', 'Light color', 'Color combination', 'Custom colors', 'Request', 'Photo file', 'Estimate #'];
var EST_HEADERS = ['Estimate #', 'Created', 'Status', 'Customer', 'Phone', 'Email', 'Street', 'City', 'ZIP',
  'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Notes', 'Approved at', 'Approved via', 'Items JSON', 'Token'];

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
   ['Approved jobs inbox', BRAND.email, "Gets the 'Approved - add to QuickBooks' email once a customer approves."]
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
  var s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  Logger.log('All set! Your sheet: ' + ss.getUrl());
  Logger.log('Edit your prices, PIN and office email in that sheet, then redeploy (Deploy > Manage deployments > Edit > New version).');
}

/* ======================= ROUTING ======================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.a === 'approve') return approvePage(p.id, p.t);
    if (p.a === 'prices') { requirePin(p.pin); return json({ ok: true, items: getPrices(), settings: publicSettings() }); }
    if (p.a === 'recent') { requirePin(p.pin); return json({ ok: true, leads: openLeads(), estimates: recentEstimates(20) }); }
    if (p.a === 'lead') { requirePin(p.pin); return json(leadDetail(p.id)); }
    return text('ok');
  } catch (err) { return json({ ok: false, error: String(err.message || err) }); }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.key === 'fcl-lead' || d.key === 'fcl-photo') return handleWebsiteLead(d);   // website quote form
    requirePin(d.pin);
    if (d.a === 'estimate') return json(createEstimate(d));
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
function leadDetail(id) {
  var sh = leadsSheet_(), row = findLeadRow(id); if (!row) return { ok: false, error: 'Lead not found' };
  var h = headerIndex(sh), r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0], lead = leadObj_(r, h);
  if (r[h['Photo file']]) {
    try { var b = DriveApp.getFileById(r[h['Photo file']]).getBlob(); lead.photo = Utilities.base64Encode(b.getBytes()); lead.photoType = b.getContentType(); } catch (e) {}
  }
  return { ok: true, lead: lead };
}

/* ======================= ESTIMATES ======================= */
function createEstimate(d) {
  var s = settings();
  var c = d.customer || {};
  if (!clean(c.name)) throw new Error('Customer name is required');
  if (!clean(c.street)) throw new Error('Street address is required');

  // Rebuild every line from the price sheet so totals can't be wrong
  var priceMap = {}; getPrices().forEach(function (p) { priceMap[p.item] = p; });
  var lines = [];
  (d.items || []).forEach(function (it) {
    var p = priceMap[it.item], q = Number(it.qty) || 0;
    if (p && q > 0) lines.push({ desc: p.item, qty: q, unit: p.unit, rate: p.price, amount: round2(q * p.price) });
  });
  (d.custom || []).forEach(function (x) {
    var amt = Number(x.amount) || 0, desc = clean(x.desc);
    if (desc && amt) lines.push({ desc: desc, qty: 1, unit: '', rate: amt, amount: round2(amt) });
  });
  if (!lines.length) throw new Error('Add at least one item');

  var t = totals(lines, d.discountType, d.discountValue, s);
  var sh = sheet('Estimates');
  var id = 'FCL-' + (1000 + sh.getLastRow());
  var token = Utilities.getUuid().replace(/-/g, '');
  var now = new Date();
  var est = {
    id: id, created: now, name: clean(c.name), phone: clean(c.phone), email: clean(c.email),
    street: clean(c.street), city: clean(c.city) || 'Frisco', zip: clean(c.zip), state: 'TX',
    lines: t.lines, subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total,
    notes: clean(d.notes, 1500), validUntil: new Date(now.getTime() + s.validDays * 864e5), footer: s.footer, token: token
  };

  var rowVals = [est.id, now, 'Sent', est.name, est.phone, est.email, est.street, est.city, est.zip,
    est.lines.map(function (l) { return l.desc + (l.unit ? ' (' + l.qty + ' ' + l.unit + ')' : '') + ' $' + money(l.amount); }).join('\n'),
    est.subtotal, est.discount, est.tax, est.total, est.notes, '', '', JSON.stringify(est.lines), token];
  var eh = headerIndex(sh); if (eh['Lead #'] !== undefined) rowVals[eh['Lead #']] = clean(d.leadId);
  for (var i = 0; i < rowVals.length; i++) if (rowVals[i] === undefined) rowVals[i] = '';
  sh.appendRow(rowVals);
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
    subject: (d.approvedOnSite ? 'Estimate approved on site: ' : 'Estimate sent: ') + est.id + ' - ' + est.name + ' - $' + money(est.total),
    htmlBody: '<p>' + (emailed ? 'Sent to ' + esc(est.email) + '.' : (d.approvedOnSite ? 'Marked approved on site.' : '<b>No customer email on file</b> - the PDF is attached so you can text or print it.')) + '</p>' + summaryTable(est),
    attachments: photo ? [pdf, photo] : [pdf]
  });

  return { ok: true, id: id, total: est.total, emailed: emailed, approved: !!d.approvedOnSite };
}

function totals(lines, discountType, discountValue, s) {
  lines = lines.slice();
  var subtotal = round2(lines.reduce(function (a, l) { return a + l.amount; }, 0));
  var dv = Math.max(0, Number(discountValue) || 0);
  var discount = discountType === 'pct' ? round2(subtotal * Math.min(dv, 100) / 100) : round2(Math.min(dv, subtotal));
  var after = round2(subtotal - discount);
  if (s.minimum > 0 && after < s.minimum) {
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
    subject: '\u2705 Approved: ' + est.name + ' - $' + money(est.total) + ' - add to QuickBooks (' + est.id + ')',
    htmlBody: officeEmail(est, via),
    attachments: att
  });
  // Customer thank-you
  if (validEmail(est.email)) {
    MailApp.sendEmail({
      to: est.email, name: BRAND.name, replyTo: s.approvedInbox,
      subject: 'You\u2019re on the schedule! Estimate ' + est.id + ' approved',
      htmlBody: wrap('<h2 style="font-family:Georgia,serif;color:' + BRAND.red + ';margin:0 0 10px">Thank you, ' + esc(firstName(est.name)) + '!</h2>' +
        '<p>Your estimate <b>' + est.id + '</b> for <b>$' + money(est.total) + '</b> is approved. We\u2019ll reach out shortly to schedule your installation.</p>' +
        '<p>Questions? Call or text <b>' + BRAND.phone + '</b>.</p>'),
      attachments: [pdf]
    });
  }
  return { ok: true, id: id, name: est.name };
}

function approvePage(id, token) {
  var r;
  try { r = approveEstimate(id, token, 'Customer clicked Approve'); } catch (err) { r = { ok: false, error: String(err) }; }
  var body = r.ok
    ? '<h1>' + (r.already ? 'Already approved' : 'Thank you!') + '</h1><p>' + (r.already ? 'Estimate ' + esc(id) + ' was already approved. ' : 'Your estimate <b>' + esc(id) + '</b> is approved. ') +
      'We\u2019ll reach out shortly to schedule your installation.</p><p>Questions? Call or text <a href="tel:+19725565120">' + BRAND.phone + '</a>.</p>'
    : '<h1>Something went wrong</h1><p>' + esc(r.error || '') + '</p><p>Please call or text <a href="tel:+19725565120">' + BRAND.phone + '</a> and we\u2019ll take care of it.</p>';
  var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + BRAND.name + '</title>' +
    '<style>body{margin:0;font-family:Helvetica,Arial,sans-serif;background:#FBF7F0;color:#2B201C;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}' +
    '.c{max-width:460px;background:#fff;border-top:5px solid ' + BRAND.red + ';border-radius:16px;padding:32px 28px;box-shadow:0 20px 50px rgba(0,0,0,.12);text-align:center}' +
    'h1{font-family:Georgia,serif;color:' + BRAND.red + ';margin:0 0 12px}a{color:' + BRAND.red + ';font-weight:bold}.b{font-family:Georgia,serif;color:' + BRAND.gold + ';font-size:14px;letter-spacing:2px;margin-bottom:14px}</style></head>' +
    '<body><div class="c"><div class="b">FRISCO CHRISTMAS LIGHTS</div>' + body + '<p><a href="' + BRAND.site + '">friscolights.com</a></p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(BRAND.name).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ======================= EMAILS & PDF ======================= */
function sendCustomerEstimate(est, pdf, photo) {
  var url = ScriptApp.getService().getUrl() + '?a=approve&id=' + encodeURIComponent(est.id) + '&t=' + est.token;
  var html = wrap(
    '<h2 style="font-family:Georgia,serif;color:' + BRAND.red + ';margin:0 0 10px">Your lighting estimate</h2>' +
    '<p>Hi ' + esc(firstName(est.name)) + ',</p><p>Thanks for choosing ' + BRAND.name + '! Here\u2019s your estimate for <b>' + esc(est.street) + '</b>.' +
    (photo ? ' We\u2019ve also attached a preview showing where your lights will go.' : '') + '</p>' +
    summaryTable(est) +
    (est.notes ? '<p style="background:#FBF7F0;border-left:3px solid ' + BRAND.gold + ';padding:10px 14px">' + esc(est.notes).replace(/\n/g, '<br>') + '</p>' : '') +
    '<p style="text-align:center;margin:28px 0"><a href="' + url + '" style="background:' + BRAND.red + ';color:#fff;text-decoration:none;font-weight:bold;padding:15px 30px;border-radius:10px;display:inline-block;font-size:16px">Approve estimate</a></p>' +
    '<p style="color:#6E615A;font-size:13px">Valid until ' + fmtDate(est.validUntil) + '. ' + esc(est.footer) + ' The full estimate is attached as a PDF.</p>' +
    '<p>Questions or changes? Just reply to this email or call/text <b>' + BRAND.phone + '</b>.</p>'
  );
  MailApp.sendEmail({ to: est.email, name: BRAND.name, replyTo: settings().estimatesInbox,
    subject: 'Your Christmas lighting estimate ' + est.id + ' - $' + money(est.total),
    htmlBody: html, attachments: photo ? [pdf, photo] : [pdf] });
}

function officeEmail(est, via) {
  var row = function (k, v) { return '<tr><td style="padding:6px 12px 6px 0;color:#6E615A;white-space:nowrap">' + k + '</td><td style="padding:6px 0;font-weight:bold">' + esc(v || '-') + '</td></tr>'; };
  return wrap(
    '<h2 style="font-family:Georgia,serif;color:' + BRAND.red + ';margin:0 0 6px">New approved install</h2>' +
    '<p style="margin:0 0 16px;color:#6E615A">' + esc(via) + ' \u2022 ' + est.id + '</p>' +
    '<h3 style="margin:18px 0 6px">Customer (QuickBooks fields)</h3><table style="border-collapse:collapse;font-size:15px">' +
    row('Display name', est.name) + row('First name', firstName(est.name)) + row('Last name', lastName(est.name)) +
    row('Email', est.email) + row('Phone', est.phone) + row('Street', est.street) + row('City', est.city) +
    row('State', est.state || 'TX') + row('ZIP', est.zip) + '</table>' +
    '<h3 style="margin:22px 0 6px">Products / services</h3>' + summaryTable(est) +
    (est.notes ? '<p><b>Notes:</b> ' + esc(est.notes) + '</p>' : '') +
    '<p style="color:#6E615A;font-size:13px">The estimate PDF is attached. Everything is also logged in the Estimates sheet.</p>');
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

function estimatePdf(est) {
  var td = 'padding:8px;border-bottom:1px solid #E6DAC6;font-size:12px;';
  var rows = est.lines.map(function (l) {
    return '<tr><td style="' + td + '">' + esc(l.desc) + '</td><td style="' + td + 'text-align:center">' + (l.unit ? l.qty + ' ' + l.unit : '') +
      '</td><td style="' + td + 'text-align:right">' + (l.unit ? '$' + money(l.rate) : '') + '</td><td style="' + td + 'text-align:right">$' + money(l.amount) + '</td></tr>';
  }).join('');
  var tr = function (k, v, b) { return '<tr><td colspan="3" style="padding:6px 8px;text-align:right;font-size:' + (b ? '15px;font-weight:bold' : '12px') + '">' + k + '</td><td style="padding:6px 8px;text-align:right;font-size:' + (b ? '15px;font-weight:bold;color:' + BRAND.red : '12px') + '">' + v + '</td></tr>'; };
  var html = '<html><body style="font-family:Helvetica,Arial,sans-serif;color:#2B201C;margin:28px">' +
    '<table style="width:100%"><tr><td><div style="font-family:Georgia,serif;font-size:26px;color:' + BRAND.red + ';font-weight:bold">Frisco Christmas Lights</div>' +
    '<div style="font-size:11px;color:#6E615A">' + BRAND.legal + ' \u2022 ' + BRAND.phone + ' \u2022 ' + BRAND.email + ' \u2022 friscolights.com</div></td>' +
    '<td style="text-align:right;vertical-align:top"><div style="font-size:20px;font-weight:bold;color:' + BRAND.gold + '">ESTIMATE</div><div style="font-size:12px">' + est.id + '<br>' + fmtDate(est.created) + '<br>Valid until ' + fmtDate(est.validUntil) + '</div></td></tr></table>' +
    '<div style="height:3px;background:' + BRAND.red + ';margin:14px 0 18px"></div>' +
    '<div style="font-size:11px;color:#6E615A;letter-spacing:1px">PREPARED FOR</div><div style="font-size:14px;font-weight:bold;margin-top:2px">' + esc(est.name) + '</div>' +
    '<div style="font-size:12px">' + esc(est.street) + ', ' + esc(est.city) + ', TX ' + esc(est.zip) + '<br>' + esc(est.phone) + (est.email ? ' \u2022 ' + esc(est.email) : '') + '</div>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:20px"><tr style="background:#F3EADB"><th style="text-align:left;padding:8px;font-size:11px">DESCRIPTION</th><th style="padding:8px;font-size:11px">QTY</th><th style="text-align:right;padding:8px;font-size:11px">RATE</th><th style="text-align:right;padding:8px;font-size:11px">AMOUNT</th></tr>' +
    rows + (est.discount ? tr('Subtotal', '$' + money(est.subtotal)) + tr('Discount', '-$' + money(est.discount)) : '') + (est.tax ? tr('Tax', '$' + money(est.tax)) : '') + tr('Total', '$' + money(est.total), true) + '</table>' +
    (est.notes ? '<div style="margin-top:18px;padding:10px 12px;background:#FBF7F0;border-left:3px solid ' + BRAND.gold + ';font-size:12px"><b>Notes:</b> ' + esc(est.notes) + '</div>' : '') +
    '<p style="font-size:11px;color:#6E615A;margin-top:22px">' + esc(est.footer) + '</p>' +
    '<p style="font-size:11px;color:#6E615A">To approve, use the Approve button in your estimate email or call/text ' + BRAND.phone + '.</p></body></html>';
  return Utilities.newBlob(html, 'text/html', est.id + '.html').getAs('application/pdf').setName('Frisco-Christmas-Lights-' + est.id + '.pdf');
}

function wrap(inner) {
  return '<div style="background:#FBF7F0;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#2B201C">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;border-top:5px solid ' + BRAND.red + ';padding:26px 24px">' +
    '<div style="font-family:Georgia,serif;font-size:13px;letter-spacing:2px;color:' + BRAND.gold + ';margin-bottom:16px">FRISCO CHRISTMAS LIGHTS</div>' + inner +
    '<p style="margin-top:26px;font-size:12px;color:#6E615A">' + BRAND.legal + ' \u2022 ' + BRAND.phone + ' \u2022 <a href="' + BRAND.site + '" style="color:' + BRAND.red + '">friscolights.com</a></p></div></div>';
}

/* ======================= DATA HELPERS ======================= */
function ss_() {
  var id = PROPS.getProperty('SHEET_ID');
  if (!id) throw new Error('Run setup first (choose "setup" and click Run in the Apps Script editor).');
  return SpreadsheetApp.openById(id);
}
function sheet(name) { var s = ss_().getSheetByName(name); if (!s) throw new Error('Missing tab: ' + name + ' (run setup)'); return s; }
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
    footer: String(v['Footer note'] || '')
  };
}
function pickEmail(a, b) { a = String(a || '').trim(); b = String(b || '').trim(); return validEmail(a) ? a : (validEmail(b) ? b : Session.getEffectiveUser().getEmail()); }
function publicSettings() { var s = settings(); return { minimum: s.minimum, taxRate: s.taxRate }; }
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
    validUntil: new Date(created.getTime() + s.validDays * 864e5), footer: s.footer, token: v[h['Token']] };
}
function recentEstimates(n) {
  var sh = sheet('Estimates'), last = sh.getLastRow(); if (last < 2) return [];
  var h = headerIndex(sh), start = Math.max(2, last - n + 1);
  return sh.getRange(start, 1, last - start + 1, sh.getLastColumn()).getValues().reverse().map(function (r) {
    return { id: r[h['Estimate #']], date: r[h['Created']] instanceof Date ? fmtDate(r[h['Created']]) : '', name: r[h['Customer']],
      street: r[h['Street']], total: Number(r[h['Total']]) || 0, status: r[h['Status']] };
  });
}

/* ======================= SMALL UTILS ======================= */
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function text(t) { return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.TEXT); }
function clean(v, n) { return String(v == null ? '' : v).trim().substring(0, n || 200); }
function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money(n) { return (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtDate(d) { return Utilities.formatDate(d, 'America/Chicago', 'MMM d, yyyy'); }
function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
function lastName(n) { var p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : ''; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
