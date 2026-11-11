// Exercises tap-to-reveal hints and math_logs hintUsed tracking.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const puppeteerModule = await import(
  fs.existsSync('/tmp/hint-test-modules/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')
    ? '/tmp/hint-test-modules/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
    : '/tmp/hint-test-modules/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
);
const puppeteer = puppeteerModule.default;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = fs.existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : '/usr/bin/google-chrome';
const sheetMarker = 'docs.google.com/spreadsheets';
const results = [];

const FIREBASE_STUB = `
window.__mathLogs = [];
window.firebase = {
  initializeApp: function () { return window.firebase; },
  firestore: function () {
    function docApi() {
      return {
        get: function () {
          return Promise.resolve({ exists: false, data: function () { return null; } });
        },
        set: function () { return Promise.resolve(); },
        onSnapshot: function () { return function () {}; }
      };
    }
    return {
      collection: function () {
        return {
          doc: function () { return docApi(); },
          add: function (data) {
            var policy = window.__logPolicy || {};
            var snap = {
              user: data.user,
              question: data.question,
              category: data.category,
              result: data.result,
              world: data.world,
              keys: Object.keys(data).sort(),
              hasHintUsed: Object.prototype.hasOwnProperty.call(data, 'hintUsed'),
              hintUsed: Object.prototype.hasOwnProperty.call(data, 'hintUsed') ? data.hintUsed : undefined
            };
            window.__mathLogs.push(snap);
            if (policy.rejectHint && data.hintUsed === true) {
              policy.rejectHint = false;
              window.__logPolicy = policy;
              return Promise.reject({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
            }
            return Promise.resolve({ id: 'log-' + window.__mathLogs.length });
          }
        };
      }
    };
  },
  auth: function () {
    var user = { email: 'player@example.com', uid: 'player' };
    return {
      currentUser: user,
      onAuthStateChanged: function (cb) {
        setTimeout(function () { cb(user); }, 0);
        return function () {};
      },
      signInWithEmailAndPassword: function () { return Promise.resolve({ user: user }); }
    };
  }
};
`;

function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' };
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const url = new URL(req.url, 'http://127.0.0.1');
      let filePath = path.join(root, decodeURIComponent(url.pathname));
      if (url.pathname === '/') filePath = path.join(root, 'index.html');
      fs.readFile(filePath, function (err, body) {
        if (err) {
          res.writeHead(404);
          res.end('missing');
          return;
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

function check(name, cond, detail) {
  results.push({ name: name, ok: !!cond, detail: detail || '' });
  if (!cond) console.error('FAIL', name, detail || '');
  else console.log('PASS', name);
}

async function openGame(browser, server, csv, viewport) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport(viewport || { width: 390, height: 680 });
  const errors = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  page.on('dialog', function (dialog) { dialog.dismiss().catch(function () {}); });
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    const url = req.url();
    if (url.indexOf(sheetMarker) !== -1) {
      req.respond({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/csv; charset=utf-8' },
        body: csv
      });
      return;
    }
    if (url.indexOf('papaparse') !== -1 && fs.existsSync('/tmp/hint-test-modules/node_modules/papaparse/papaparse.min.js')) {
      req.respond({
        status: 200,
        contentType: 'application/javascript',
        body: fs.readFileSync('/tmp/hint-test-modules/node_modules/papaparse/papaparse.min.js')
      });
      return;
    }
    if (url.indexOf('firebase-app-compat') !== -1) {
      req.respond({ status: 200, contentType: 'application/javascript', body: FIREBASE_STUB });
      return;
    }
    if (url.indexOf('firebase') !== -1 || url.indexOf('canvas-confetti') !== -1) {
      req.respond({ status: 200, contentType: 'application/javascript', body: 'function confetti(){}' });
      return;
    }
    req.continue().catch(function () {});
  });
  const port = server.address().port;
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () {
    var el = document.getElementById('qText');
    return el && document.querySelectorAll('.brick-btn').length >= 2 && el.textContent.indexOf('Waiting') === -1;
  });
  page.__errors = errors;
  return page;
}

async function clickChoice(page, label) {
  const found = await page.evaluate(function (wanted) {
    var buttons = Array.from(document.querySelectorAll('.brick-btn'));
    var btn = buttons.find(function (b) { return b.innerText.trim() === wanted; });
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  if (!found) throw new Error('No option labeled ' + label);
}

function logsOf(page) {
  return page.evaluate(function () {
    return (window.__mathLogs || []).map(function (row) {
      return {
        user: row.user,
        result: row.result,
        category: row.category,
        world: row.world,
        keys: row.keys,
        hasHintUsed: row.hasHintUsed,
        hintUsed: row.hintUsed,
        question: row.question
      };
    });
  });
}

async function hintState(page) {
  return page.evaluate(function () {
    var slot = document.getElementById('hintSlot');
    var btn = document.getElementById('hintBtn');
    var text = document.getElementById('hintText');
    var feedback = document.getElementById('feedback');
    var bricks = Array.from(document.querySelectorAll('.brick-btn')).map(function (b) {
      return {
        label: b.innerText.trim(),
        opacity: b.style.opacity,
        cursor: b.style.cursor,
        border: b.style.border,
        disabled: b.disabled
      };
    });
    var box = btn ? btn.getBoundingClientRect() : null;
    return {
      slotHidden: !slot || slot.hidden,
      btnText: btn ? btn.textContent : '',
      btnHidden: !btn || btn.hidden,
      textHidden: !text || text.hidden,
      text: text ? text.textContent : '',
      feedback: feedback ? feedback.textContent : '',
      feedbackClass: feedback ? feedback.className : '',
      hintRevealed: hintRevealed === true,
      bricks: bricks,
      btnTop: box ? box.top : -1,
      btnHeight: box ? box.height : 0,
      btnWidth: box ? box.width : 0
    };
  });
}

const hinted = [
  'Question,Image,Option1,Option2,Option3,Answer,Category,Hint',
  '"What is 8 + 4?","","12","11","13","12","Addition","Make a ten, then add the extra."'
].join('\n');

const noHintColumn = [
  'Question,Image,Option1,Option2,Option3,Answer,Category',
  '"What is 5 + 5?","","10","9","11","10","Addition"'
].join('\n');

const blankHint = [
  'Question,Image,Option1,Option2,Option3,Answer,Category,hint',
  '"What is 6 + 1?","","7","6","8","7","Addition","   "'
].join('\n');

const answerAsHint = [
  'Question,Image,Option1,Option2,Option3,Answer,Category,HINT',
  '"What is 9 + 0?","","9","8","10","9","Addition","9"'
].join('\n');

const quotedCsv = [
  'Question,Image,Option1,Option2,Option3,Answer,Category, Hint ',
  '"Share 8, or ""half"", of 16 apples. How many?","","8","6","4","8","Division","Split into groups, ""not"" the final box."',
  '"What is 3 + 3?","","6","5","4","6","Addition",""'
].join('\n');

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required']
  });
  try {
    const parsePage = await openGame(browser, server, hinted, { width: 1100, height: 800 });
    const parsed = await parsePage.evaluate(async function (quoted, legacy) {
      var bom = '\uFEFF' + quoted;
      var rows = await questionsFromCsv(bom);
      var oldRows = await questionsFromCsv(legacy);
      var mixed = await questionsFromCsv(quoted + '\n' + '"Newline hint","","1","2","3","1","Addition","First line,\nsecond line"');
      var answerRow = { Question: 'What is 9 + 0?', Answer: '9', Hint: '9' };
      return {
        rows: rows,
        oldRows: oldRows,
        mixedLast: mixed[mixed.length - 1],
        answerHint: questionHint(answerRow),
        strategyHint: questionHint(rows[0])
      };
    }, quotedCsv, noHintColumn);
    check('quoted header maps to Hint', parsed.rows[0] && parsed.rows[0].Hint === 'Split into groups, "not" the final box.', JSON.stringify(parsed.rows[0]));
    check('quoted question keeps comma', parsed.rows[0] && parsed.rows[0].Question === 'Share 8, or "half", of 16 apples. How many?', parsed.rows[0] && parsed.rows[0].Question);
    check('quoted row keeps answer', parsed.rows[0] && parsed.rows[0].Answer === '8' && parsed.rows[0].Option2 === '6', JSON.stringify(parsed.rows[0]));
    check('empty hint cell stays blank', parsed.rows[1] && parsed.rows[1].Hint === '', JSON.stringify(parsed.rows[1]));
    check('legacy csv has no hint', parsed.oldRows && parsed.oldRows.length === 1 && !parsed.oldRows[0].Hint && parsed.oldRows[0].Question === 'What is 5 + 5?', JSON.stringify(parsed.oldRows && parsed.oldRows[0]));
    check('quoted newline hint stays one field', parsed.mixedLast && parsed.mixedLast.Hint === 'First line,\nsecond line' && parsed.mixedLast.Answer === '1', JSON.stringify(parsed.mixedLast));
    check('hint equal to answer is not offered', parsed.answerHint === '' && parsed.strategyHint.indexOf('Split into groups') === 0, parsed.answerHint + ' | ' + parsed.strategyHint);
    await parsePage.close();

    const desktop = await openGame(browser, server, hinted, { width: 1100, height: 800 });
    let state = await hintState(desktop);
    check('correct-first shows no hint button', state.slotHidden && state.text === '', JSON.stringify(state));
    await clickChoice(desktop, '12');
    state = await hintState(desktop);
    let logs = await logsOf(desktop);
    check('correct-first still has no hint', state.slotHidden, JSON.stringify(state));
    check('correct-first logs one attempt without hintUsed', logs.length === 1 && logs[0].result === 'Correct' && logs[0].hasHintUsed === false && logs[0].user === 'player@example.com' && logs[0].category === 'Addition', JSON.stringify(logs));
    check('build id is current', await desktop.evaluate(function () { return APP_BUILD; }) === '2026-11-11b');
    await desktop.close();

    const phone = await openGame(browser, server, hinted, { width: 390, height: 680 });
    state = await hintState(phone);
    check('phone first look has no hint', state.slotHidden, JSON.stringify(state));
    await clickChoice(phone, '11');
    state = await hintState(phone);
    logs = await logsOf(phone);
    const wrongBrick = state.bricks.find(function (b) { return b.label === '11'; });
    check('wrong answer shows Hint button', !state.slotHidden && state.btnText.trim() === 'Hint' && state.textHidden, JSON.stringify(state));
    check('hint button is a clear tap target', state.btnHeight >= 40 && state.btnWidth >= 100 && state.btnTop >= 0 && state.btnTop < 680, JSON.stringify(state));
    check('feedback stays on the wrong answer', state.feedbackClass === 'wrong' && state.feedback.indexOf('WAIT') === 0, state.feedback);
    check('wrong option stays marked', wrongBrick && wrongBrick.opacity === '0.5' && wrongBrick.border.indexOf('red') !== -1, JSON.stringify(wrongBrick));
    check('first wrong log has no hintUsed', logs.length === 1 && logs[0].result === 'Wrong' && logs[0].hasHintUsed === false, JSON.stringify(logs));
    await phone.click('#hintBtn');
    state = await hintState(phone);
    logs = await logsOf(phone);
    const wrongAfter = state.bricks.find(function (b) { return b.label === '11'; });
    check('tap reveals the strategy', state.text === 'Make a ten, then add the extra.' && state.text !== '12', state.text);
    check('reveal does not add a log', logs.length === 1 && logs[0].hasHintUsed === false, JSON.stringify(logs));
    check('reveal keeps feedback and the wrong option', state.feedbackClass === 'wrong' && state.feedback.length > 0 && wrongAfter.opacity === '0.5' && wrongAfter.border.indexOf('red') !== -1, JSON.stringify({ feedback: state.feedback, wrongAfter: wrongAfter }));
    await phone.waitForFunction(function () { return document.getElementById('feedback').textContent === 'TRY AGAIN'; });
    state = await hintState(phone);
    const stillWrong = state.bricks.find(function (b) { return b.label === '11'; });
    const other = state.bricks.find(function (b) { return b.label === '13'; });
    check('retry keeps the hint and the dim wrong option', state.text === 'Make a ten, then add the extra.' && state.feedback === 'TRY AGAIN' && stillWrong.opacity === '0.5' && other.opacity === '1', JSON.stringify(state));
    await clickChoice(phone, '12');
    await phone.waitForFunction(function () {
      return document.getElementById('hintSlot').hidden && document.getElementById('feedback').textContent === '';
    });
    state = await hintState(phone);
    logs = await logsOf(phone);
    check('next question hides the hint', state.slotHidden && state.text === '' && state.hintRevealed === false, JSON.stringify(state));
    check('retry log sets hintUsed and leaves the first attempt alone', logs.length === 2 && logs[0].result === 'Wrong' && logs[0].hasHintUsed === false && logs[1].result === 'Correct' && logs[1].hintUsed === true && logs[1].keys.indexOf('user') !== -1 && logs[1].keys.indexOf('question') !== -1 && logs[1].keys.indexOf('category') !== -1 && logs[1].keys.indexOf('result') !== -1 && logs[1].keys.indexOf('world') !== -1 && logs[1].keys.indexOf('timestamp') !== -1, JSON.stringify(logs));
    await phone.close();

    const missing = await openGame(browser, server, noHintColumn);
    await clickChoice(missing, '9');
    state = await hintState(missing);
    logs = await logsOf(missing);
    check('missing hint column shows no button', state.slotHidden && state.text === '', JSON.stringify(state));
    check('missing hint log has no hintUsed', logs.length === 1 && logs[0].hasHintUsed === false && logs[0].result === 'Wrong', JSON.stringify(logs));
    await missing.close();

    const blank = await openGame(browser, server, blankHint);
    await clickChoice(blank, '6');
    state = await hintState(blank);
    check('blank hint shows no button', state.slotHidden, JSON.stringify(state));
    await blank.close();

    const copied = await openGame(browser, server, answerAsHint);
    await clickChoice(copied, '8');
    state = await hintState(copied);
    check('hint that is only the answer shows no button', state.slotHidden && state.text === '', JSON.stringify(state));
    await copied.close();

    const second = await openGame(browser, server, hinted);
    await clickChoice(second, '11');
    await second.waitForFunction(function () { return document.getElementById('feedback').textContent === 'TRY AGAIN'; });
    await clickChoice(second, '13');
    logs = await logsOf(second);
    check('second wrong before reveal does not claim hintUsed', logs.length === 2 && logs.every(function (row) { return row.result === 'Wrong' && row.hasHintUsed === false; }), JSON.stringify(logs));
    await second.waitForFunction(function () { return document.getElementById('feedback').textContent === 'TRY AGAIN'; });
    await second.click('#hintBtn');
    await second.waitForFunction(function () { return document.getElementById('feedback').textContent === 'TRY AGAIN'; });
    await clickChoice(second, '12');
    await new Promise(function (resolve) { setTimeout(resolve, 80); });
    logs = await logsOf(second);
    check('only the attempt after reveal is marked hintUsed', logs.length === 3 && logs[0].hasHintUsed === false && logs[1].hasHintUsed === false && logs[2].hintUsed === true && logs[2].result === 'Correct', JSON.stringify(logs));
    await second.close();

    const denied = await openGame(browser, server, hinted);
    await denied.evaluate(function () { window.__logPolicy = { rejectHint: true }; });
    await clickChoice(denied, '11');
    await denied.waitForFunction(function () { return document.getElementById('feedback').textContent === 'TRY AGAIN'; });
    await denied.click('#hintBtn');
    await clickChoice(denied, '12');
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
    logs = await logsOf(denied);
    check('rules rejection retries the same attempt without hintUsed', logs.length === 3 && logs[0].result === 'Wrong' && logs[0].hasHintUsed === false && logs[1].result === 'Correct' && logs[1].hintUsed === true && logs[2].result === 'Correct' && logs[2].hasHintUsed === false && logs[2].question === logs[1].question, JSON.stringify(logs));
    await denied.close();

    const live = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vREhCuPrIB_HZ6Pa1IKHHrusqwgQddjZNGhnjr4W2TRG-jAuBgtakUZZdIQTHEQbjYniUaEpvVh1fXI/pub?output=csv');
    const liveText = await live.text();
    const livePage = await openGame(browser, server, hinted);
    const liveParsed = await livePage.evaluate(async function (csv) {
      var rows = await questionsFromCsv(csv);
      var keys = rows[0] ? Object.keys(rows[0]) : [];
      var sameKeys = rows.every(function (row) {
        var rowKeys = Object.keys(row);
        return rowKeys.length === keys.length && rowKeys.every(function (key, index) { return key === keys[index]; });
      });
      function findQuestion(text) {
        return rows.filter(function (row) { return row.Question === text; })[0] || null;
      }
      var kept = findQuestion('68 + ? = 511');
      var quoted = findQuestion('What comes next: 14, 21, 28, 35, ?');
      var added = findQuestion('What is 47 + 38?');
      var funBlank = rows.filter(function (row) {
        return String(row.Category || '').trim().toLowerCase() === 'fun' && !String(row.Hint || '').trim();
      }).length;
      var funHinted = rows.filter(function (row) {
        return String(row.Category || '').trim().toLowerCase() === 'fun' && String(row.Hint || '').trim();
      }).length;
      var mathsHinted = rows.filter(function (row) {
        return String(row.Category || '').trim().toLowerCase() !== 'fun' && String(row.Hint || '').trim();
      }).length;
      return {
        count: rows.length,
        keys: keys,
        sameKeys: sameKeys,
        kept: kept,
        keptHint: kept ? questionHint(kept) : '',
        quoted: quoted ? { Question: quoted.Question, Answer: quoted.Answer, Category: quoted.Category, hint: questionHint(quoted) } : null,
        added: added ? { Answer: added.Answer, Category: added.Category, hint: questionHint(added), option1: added.Option1 } : null,
        funBlank: funBlank,
        funHinted: funHinted,
        mathsHinted: mathsHinted
      };
    }, liveText);
    check('published csv has eight columns', liveParsed.count === 669 && liveParsed.sameKeys && liveParsed.keys.join('|') === 'Question|Image|Option1|Option2|Option3|Answer|Category|Hint', JSON.stringify({ count: liveParsed.count, keys: liveParsed.keys, sameKeys: liveParsed.sameKeys }));
    check('published 68 + ? = 511 answer row is unchanged', liveParsed.kept && liveParsed.kept.Option1 === '442' && liveParsed.kept.Option2 === '443' && liveParsed.kept.Option3 === '444' && liveParsed.kept.Answer === '443' && liveParsed.kept.Category === 'Addition' && liveParsed.keptHint.indexOf('443') === -1 && liveParsed.keptHint !== '443', JSON.stringify(liveParsed.kept));
    check('published quoted pattern row stays one question', liveParsed.quoted && liveParsed.quoted.Answer === '42' && liveParsed.quoted.Category === 'Patterns' && liveParsed.quoted.hint.indexOf('7') !== -1 && liveParsed.quoted.hint.indexOf('42') === -1, JSON.stringify(liveParsed.quoted));
    check('published appended addition row keeps its method hint', liveParsed.added && liveParsed.added.Answer === '85' && liveParsed.added.Category === 'Addition' && liveParsed.added.hint.length > 10 && liveParsed.added.hint.indexOf('85') === -1, JSON.stringify(liveParsed.added));
    check('published fun rows have no hint and maths rows do', liveParsed.funBlank === 99 && liveParsed.funHinted === 0 && liveParsed.mathsHinted === 570, JSON.stringify({ funBlank: liveParsed.funBlank, funHinted: liveParsed.funHinted, mathsHinted: liveParsed.mathsHinted }));
    await livePage.close();
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(function (row) { return !row.ok; });
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, names: results.map(function (row) { return (row.ok ? 'ok ' : 'bad ') + row.name; }) }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
