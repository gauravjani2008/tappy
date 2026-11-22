const { Redis } = require('@upstash/redis');
const { Resend } = require('resend');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const resend = new Resend(process.env.RESEND_API_KEY);

const UIDS_KEY = 'tappy:uids';
function expensesKey(uid) { return 'tappy:expenses:' + uid; }
function settingsKey(uid) { return 'tappy:settings:' + uid; }
const TZ = 'Asia/Kolkata';

function parseEmails(str) {
  return (str || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function istParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function isLastDayOfMonthIST(date) {
  var today = istParts(date);
  var tomorrow = istParts(new Date(date.getTime() + 24 * 60 * 60 * 1000));
  return tomorrow.day === 1 && (tomorrow.month !== today.month || tomorrow.year !== today.year);
}

function fmtMoney(n) {
  var v = Math.round(n * 100) / 100;
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: v % 1 === 0 ? 0 : 2 });
}

async function buildAndSendReportFor(uid, now) {
  var settingsRaw = await redis.get(settingsKey(uid));
  var userSettings = settingsRaw ? (typeof settingsRaw === 'string' ? JSON.parse(settingsRaw) : settingsRaw) : {};
  var recipients = parseEmails(userSettings.reportEmail);
  if (!recipients.length) return { uid: uid, skipped: true, reason: 'no report email set for this device' };

  var all = await redis.hgetall(expensesKey(uid));
  var list = all ? Object.values(all).map(function (v) { return typeof v === 'string' ? JSON.parse(v) : v; }) : [];

  var ist = istParts(now);
  var monthExpenses = list.filter(function (e) {
    var d = new Date(e.ts);
    var p = istParts(d);
    return p.year === ist.year && p.month === ist.month && !e.credit;
  });

  var total = monthExpenses.reduce(function (s, e) { return s + e.amount; }, 0);
  var byCat = {};
  monthExpenses.forEach(function (e) {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  });
  var catRows = Object.keys(byCat)
    .map(function (c) { return { cat: c, amt: byCat[c] }; })
    .sort(function (a, b) { return b.amt - a.amt; });

  var monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: TZ }).format(now);

  var rowsHtml = catRows.map(function (r) {
    var pct = total > 0 ? Math.round((r.amt / total) * 100) : 0;
    return '<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">' + r.cat + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">' + fmtMoney(r.amt) + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#888;">' + pct + '%</td></tr>';
  }).join('');

  var txRows = monthExpenses
    .slice()
    .sort(function (a, b) { return b.ts - a.ts; })
    .map(function (e) {
      return '<tr><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">' + (e.dateLabel || '') + '</td>' +
        '<td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">' + e.category + '</td>' +
        '<td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">' + (e.note || '') + '</td>' +
        '<td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">' + fmtMoney(e.amount) + '</td></tr>';
    }).join('');

  var html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#111;">' +
    '<h1 style="font-size:20px;">Tappy – ' + monthName + ' Expense Report</h1>' +
    '<p style="font-size:28px;font-weight:700;margin:4px 0 20px;">' + fmtMoney(total) + ' spent</p>' +
    '<h2 style="font-size:15px;color:#555;margin-bottom:8px;">By category</h2>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">' + rowsHtml + '</table>' +
    '<h2 style="font-size:15px;color:#555;margin-bottom:8px;">All transactions</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' + txRows + '</table>' +
    '<p style="color:#999;font-size:12px;margin-top:24px;">Sent automatically by your Tappy expense tracker.</p>' +
    '</div>';

  await resend.emails.send({
    from: 'Tappy <onboarding@resend.dev>',
    to: recipients,
    subject: 'Tappy: ' + monthName + ' expense report – ' + fmtMoney(total),
    html: html,
  });

  return { uid: uid, sent: true, total: total, count: monthExpenses.length, recipients: recipients };
}

module.exports = async (req, res) => {
  // Vercel Cron sends a GET; allow manual trigger with ?force=1 for testing,
  // and ?uid=xxx to test a single device without emailing everyone.
  var force = req.query && req.query.force === '1';
  var onlyUid = req.query && req.query.uid;
  var now = new Date();

  if (!force && !isLastDayOfMonthIST(now)) {
    return res.status(200).json({ skipped: true, reason: 'not last day of month in IST' });
  }

  try {
    var uids;
    if (onlyUid) {
      uids = [onlyUid];
    } else {
      uids = await redis.smembers(UIDS_KEY);
    }
    if (!uids || !uids.length) {
      return res.status(200).json({ sent: false, reason: 'no devices have used the app yet' });
    }

    var results = [];
    for (var i = 0; i < uids.length; i++) {
      try {
        results.push(await buildAndSendReportFor(uids[i], now));
      } catch (err) {
        results.push({ uid: uids[i], error: String(err && err.message || err) });
      }
    }

    return res.status(200).json({ done: true, results: results });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
};
