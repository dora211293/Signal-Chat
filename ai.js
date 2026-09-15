/* ============================================================================
 * SIGNAL - AI機能 (ai.js)
 * ----------------------------------------------------------------------------
 * index.html 側は以下の2点だけを行う:
 *   1) 本体スクリプトの最後で window.SignalAIBridge を用意し、
 *      'signal:ai-bridge-ready' イベントを発火する
 *   2) </body> の直前で <script src="ai.js"></script> を読み込む
 * それ以外のUI・CSS・ロジックはすべてこのファイル内で完結する。
 *
 * 2つのモード:
 *   - アシストモード: Siriのような単発の指示→実行型。オーブUIで短く応答。
 *     チャンネル切替・DM切替・メッセージ送信・要約などをツール呼び出しで実行する。
 *   - 会話モード: 通常のAIチャットUI。マルチターンの雑談・相談ができる。
 *
 * 利用にはユーザー自身のAnthropic APIキーが必要（⚙から設定、localStorage保存）。
 * ========================================================================= */
(function () {
  'use strict';

  const LS_KEY = 'signal_ai_api_key';
  const LS_MODEL = 'signal_ai_model';
  const LS_VOICE = 'signal_ai_voice';
  const LS_HISTORY = 'signal_ai_chat_history';
  const DEFAULT_MODEL = 'claude-sonnet-4-6';
  const API_URL = 'https://api.anthropic.com/v1/messages';

  let bridge = null;
  let built = false;
  let mode = 'assist'; // 'assist' | 'chat'
  let busy = false;
  let chatHistory = [];
  let recognizer = null;
  let listening = false;
  let localNoticeShown = false;

  /* ------------------------------------------------------------------ */
  /* ブリッジ取得待ち                                                      */
  /* ------------------------------------------------------------------ */
  function boot(detail) {
    bridge = detail || window.SignalAIBridge;
    if (!bridge) return;
    injectStyle();
    injectTrigger();
  }
  if (window.SignalAIBridge) {
    boot(window.SignalAIBridge);
  } else {
    window.addEventListener('signal:ai-bridge-ready', (e) => boot(e.detail), { once: true });
  }

  /* ------------------------------------------------------------------ */
  /* スタイル                                                             */
  /* ------------------------------------------------------------------ */
  function injectStyle() {
    if (document.getElementById('sai-style')) return;
    const style = document.createElement('style');
    style.id = 'sai-style';
    style.textContent = `
#sai-trigger-btn{
  width:34px; height:34px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
  background:none; border:none; color: var(--text-muted); padding:0; position:relative;
  transition: color .25s ease, transform .3s var(--ease-spring);
}
#sai-trigger-btn:active{ transform: scale(.88); }
#sai-trigger-btn svg{ filter: drop-shadow(0 0 0 transparent); transition: filter .3s ease; }
#sai-trigger-btn.sai-glow{ color: var(--amber); }
#sai-trigger-btn.sai-glow svg{ filter: drop-shadow(0 0 6px var(--amber-dim)); }

.sai-card{ width:min(440px, 100vw); max-width:440px; display:flex; flex-direction:column; height:min(640px, 82vh); padding:0; overflow:hidden; }
.sai-head{ display:flex; align-items:center; gap:8px; padding: 16px 16px 10px; flex-shrink:0; }
.sai-head .scope-switch{ margin:0; flex:1; }
.sai-icon-btn{
  width:32px; height:32px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
  background: var(--surface-2); border:1px solid var(--border); border-radius: var(--radius-pill);
  color: var(--text-muted); font-size:14px; padding:0; transition: color .2s ease, border-color .2s ease, transform .3s var(--ease-spring);
}
.sai-icon-btn:active{ transform: scale(.88); }
.sai-icon-btn.sai-active{ color: var(--amber); border-color: var(--amber-dim); }

.sai-settings{ padding: 4px 16px 14px; display:flex; flex-direction:column; gap:10px; flex-shrink:0; border-bottom:1px solid var(--border); }
.sai-settings label{ font-size:11.5px; color: var(--text-muted); font-family: var(--font-mono); }
.sai-settings input[type="password"], .sai-settings input[type="text"]{
  width:100%; background: var(--surface-2); border:1px solid var(--border); border-radius: var(--radius-sm);
  color: var(--text); font-size:13px; padding:9px 11px; outline:none; font-family: var(--font-mono);
}
.sai-settings input:focus{ border-color: var(--amber-dim); }
.sai-switch-row{ display:flex !important; align-items:center; justify-content:space-between; font-family: var(--font-body) !important; font-size:13px !important; color: var(--text) !important; }
.sai-settings-row-btn{
  align-self:flex-end; background: var(--amber); color: var(--segment-active-text); border:none; font-weight:700;
  font-size:12.5px; padding:8px 16px; border-radius: var(--radius-pill);
}
.sai-settings-hint{ font-size:11px; color: var(--text-faint); line-height:1.5; }
.sai-settings-hint a{ color: var(--amber); }

.sai-body{ flex:1; min-height:0; display:flex; flex-direction:column; position:relative; }

/* ---------- アシストモード ---------- */
.sai-assist-view{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding: 20px; }
.sai-orb{ width:120px; height:120px; position:relative; display:flex; align-items:center; justify-content:center; }
.sai-orb-core{
  width:72px; height:72px; border-radius:50%;
  background: radial-gradient(circle at 32% 28%, #fff8 0%, var(--amber) 35%, var(--teal) 100%);
  box-shadow: 0 0 30px var(--amber-dim), 0 0 60px var(--teal-dim);
  animation: saiBreathe 3.2s ease-in-out infinite;
}
.sai-orb-ring{
  position:absolute; inset:0; border-radius:50%; border:1.5px solid var(--amber-dim);
  animation: saiRing 3.2s ease-in-out infinite;
}
@keyframes saiBreathe{ 0%,100%{ transform:scale(1); } 50%{ transform:scale(1.08); } }
@keyframes saiRing{ 0%,100%{ transform:scale(.92); opacity:.5; } 50%{ transform:scale(1.15); opacity:.1; } }
.sai-orb.sai-thinking .sai-orb-core{ animation: saiBreathe 1s ease-in-out infinite; }
.sai-orb.sai-thinking .sai-orb-ring{ animation: saiRing .9s ease-in-out infinite; border-color: var(--teal-dim); }
.sai-orb.sai-listening .sai-orb-core{ background: radial-gradient(circle at 32% 28%, #fff8 0%, var(--teal) 35%, var(--amber) 100%); animation: saiBreathe .6s ease-in-out infinite; }
.sai-orb.sai-listening .sai-orb-ring{ border-color: var(--teal); animation: saiRing .6s ease-in-out infinite; }

.sai-caption{ max-width: 100%; text-align:center; font-size:15px; line-height:1.6; color: var(--text); min-height: 1.6em; white-space:pre-wrap; }
.sai-caption.sai-placeholder{ color: var(--text-faint); }
.sai-suggest{ display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
.sai-chip{
  background: var(--surface-2); border:1px solid var(--border); color: var(--text-muted);
  font-size:12px; padding:7px 13px; border-radius: var(--radius-pill);
}
.sai-chip:active{ transform: scale(.95); }

/* ---------- 会話モード ---------- */
.sai-chat-view{ flex:1; display:flex; flex-direction:column; min-height:0; }
.sai-chat-scroll{ flex:1; overflow-y:auto; padding: 14px 16px; display:flex; flex-direction:column; gap:10px; }
.sai-chat-empty{ margin:auto; text-align:center; color: var(--text-faint); font-size:13px; padding: 30px 10px; }
.sai-msg{ max-width:82%; padding:10px 13px; border-radius: var(--radius-md); font-size:13.5px; line-height:1.55; white-space:pre-wrap; word-break: break-word; }
.sai-msg.sai-user{ align-self:flex-end; background: var(--mine-bubble-1); color: var(--mine-bubble-text); border-bottom-right-radius: 6px; }
.sai-msg.sai-ai{ align-self:flex-start; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-bottom-left-radius: 6px; }
.sai-msg.sai-error{ align-self:center; background: var(--danger); color:#fff; font-size:12px; opacity:.92; }
.sai-msg.sai-ai .sai-cursor{ display:inline-block; width:2px; height:1em; background: var(--amber); vertical-align:-2px; animation: saiBlink .8s steps(1) infinite; margin-left:1px; }
@keyframes saiBlink{ 50%{ opacity:0; } }

.sai-input-row{ display:flex; align-items:flex-end; gap:8px; padding: 10px 14px; border-top:1px solid var(--border); flex-shrink:0; }
#sai-input{
  flex:1; resize:none; max-height:100px; background: var(--surface-2); border:1px solid var(--border);
  border-radius: var(--radius-md); color: var(--text); font-size:13.5px; font-family: inherit; padding:9px 13px; outline:none;
}
#sai-input:focus{ border-color: var(--amber-dim); }
#sai-mic-btn.sai-listening{ color: var(--teal); border-color: var(--teal-dim); }
.sai-send-btn{
  width:36px; height:36px; flex-shrink:0; border-radius:50%; border:none; background: var(--amber);
  color: var(--segment-active-text); display:flex; align-items:center; justify-content:center; font-size:15px;
  transition: opacity .2s ease, transform .3s var(--ease-spring);
}
.sai-send-btn:disabled{ opacity:.4; }
.sai-send-btn:active:not(:disabled){ transform: scale(.9); }
`;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* トリガーボタン                                                        */
  /* ------------------------------------------------------------------ */
  function injectTrigger() {
    const host = document.getElementById('topbar-right') || bridge.els.topbarRight;
    if (!host || document.getElementById('sai-trigger-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'sai-trigger-btn';
    btn.title = 'AIアシスタント';
    btn.innerHTML = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7L12 3z" fill="currentColor" stroke="currentColor" stroke-width=".6" stroke-linejoin="round"/>
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" fill="currentColor"/>
    </svg>`;
    const searchWrap = document.getElementById('search-wrap');
    if (searchWrap) host.insertBefore(btn, searchWrap);
    else host.appendChild(btn);
    btn.addEventListener('click', () => { ensurePanel(); openPanel(btn); });
  }

  /* ------------------------------------------------------------------ */
  /* パネル構築                                                           */
  /* ------------------------------------------------------------------ */
  let panelEl, capEl, chatScrollEl, inputEl, sendBtn, micBtn, settingsEl, orbEl, suggestEl;

  function ensurePanel() {
    if (built) return;
    built = true;
    const wrap = document.createElement('div');
    wrap.className = 'modal-scrim bottom-sheet';
    wrap.id = 'sai-modal';
    wrap.style.display = 'none';
    wrap.innerHTML = `
      <div class="modal-card admin-card sai-card">
        <div class="sai-head">
          <div class="scope-switch show" id="sai-seg">
            <div class="tab-thumb"></div>
            <button type="button" data-mode="assist" class="active">アシスト</button>
            <button type="button" data-mode="chat">会話</button>
          </div>
          <button type="button" class="sai-icon-btn" id="sai-settings-btn" title="AI設定">⚙</button>
          <button type="button" class="sai-icon-btn" id="sai-close-btn" title="閉じる">✕</button>
        </div>
        <div class="sai-settings" id="sai-settings" style="display:none;">
          <label>Anthropic APIキー（このブラウザにのみ保存されます）</label>
          <input type="password" id="sai-key-input" placeholder="sk-ant-...">
          <label>モデル</label>
          <input type="text" id="sai-model-input" placeholder="${DEFAULT_MODEL}">
          <label class="sai-switch-row"><span>応答を音声で読み上げる</span>
            <label class="settings-switch"><input type="checkbox" id="sai-voice-toggle"><span></span></label>
          </label>
          <div class="sai-settings-hint">APIキーはAnthropicコンソールで発行できます。入力内容は端末のlocalStorageにのみ保存され、サーバーには送信されません。</div>
          <button type="button" class="sai-settings-row-btn" id="sai-key-save">保存</button>
        </div>
        <div class="sai-body">
          <div class="sai-assist-view" id="sai-assist-view">
            <div class="sai-orb" id="sai-orb"><div class="sai-orb-ring"></div><div class="sai-orb-core"></div></div>
            <div class="sai-caption sai-placeholder" id="sai-caption">なにか話しかけてください（APIキー未設定でも簡単な操作やFAQには答えられます）</div>
            <div class="sai-suggest" id="sai-suggest">
              <button type="button" class="sai-chip" data-cmd="今のチャットの内容を要約して">要約して</button>
              <button type="button" class="sai-chip" data-cmd="フレンド一覧を教えて">フレンド一覧</button>
              <button type="button" class="sai-chip" data-cmd="設定を開いて">設定を開く</button>
            </div>
          </div>
          <div class="sai-chat-view" id="sai-chat-view" style="display:none;">
            <div class="sai-chat-scroll" id="sai-chat-scroll"><div class="sai-chat-empty">AIと自由に会話できます（APIキー未設定時はSIGNALのFAQに簡易回答）</div></div>
          </div>
        </div>
        <div class="sai-input-row">
          <button type="button" class="sai-icon-btn" id="sai-mic-btn" title="音声入力" style="display:none;">🎙</button>
          <textarea id="sai-input" rows="1" placeholder="指示やメッセージを入力…"></textarea>
          <button type="button" class="sai-send-btn" id="sai-send-btn" title="送信">➤</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    panelEl = wrap;
    capEl = wrap.querySelector('#sai-caption');
    chatScrollEl = wrap.querySelector('#sai-chat-scroll');
    inputEl = wrap.querySelector('#sai-input');
    sendBtn = wrap.querySelector('#sai-send-btn');
    micBtn = wrap.querySelector('#sai-mic-btn');
    settingsEl = wrap.querySelector('#sai-settings');
    orbEl = wrap.querySelector('#sai-orb');
    suggestEl = wrap.querySelector('#sai-suggest');

    wrap.addEventListener('click', (e) => { if (e.target === wrap) closePanel(); });
    wrap.querySelector('#sai-close-btn').addEventListener('click', closePanel);
    wrap.querySelector('#sai-settings-btn').addEventListener('click', toggleSettings);
    wrap.querySelector('#sai-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (b) setMode(b.dataset.mode);
    });
    suggestEl.addEventListener('click', (e) => {
      const b = e.target.closest('.sai-chip');
      if (b) { inputEl.value = b.dataset.cmd; handleSend(); }
    });
    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(100, inputEl.scrollHeight) + 'px';
    });

    loadSettingsUI();
    setupSpeech();
    loadChatHistory();
    renderChat();
  }

  function toggleSettings() {
    settingsEl.style.display = settingsEl.style.display === 'none' ? 'flex' : 'none';
    if (settingsEl.style.display === 'flex') settingsEl.style.display = 'flex';
  }
  function loadSettingsUI() {
    panelEl.querySelector('#sai-key-input').value = localStorage.getItem(LS_KEY) || '';
    panelEl.querySelector('#sai-model-input').value = localStorage.getItem(LS_MODEL) || '';
    panelEl.querySelector('#sai-voice-toggle').checked = localStorage.getItem(LS_VOICE) === '1';
    panelEl.querySelector('#sai-key-save').addEventListener('click', () => {
      const key = panelEl.querySelector('#sai-key-input').value.trim();
      const model = panelEl.querySelector('#sai-model-input').value.trim();
      const voice = panelEl.querySelector('#sai-voice-toggle').checked;
      if (key) localStorage.setItem(LS_KEY, key); else localStorage.removeItem(LS_KEY);
      if (model) localStorage.setItem(LS_MODEL, model); else localStorage.removeItem(LS_MODEL);
      localStorage.setItem(LS_VOICE, voice ? '1' : '0');
      settingsEl.style.display = 'none';
    });
  }
  function getApiKey() { return (localStorage.getItem(LS_KEY) || '').trim(); }
  function getModel() { return (localStorage.getItem(LS_MODEL) || '').trim() || DEFAULT_MODEL; }
  function voiceEnabled() { return localStorage.getItem(LS_VOICE) === '1'; }

  function setMode(next) {
    mode = next;
    const seg = panelEl.querySelector('#sai-seg');
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === next));
    const thumb = seg.querySelector('.tab-thumb');
    thumb.style.width = 'calc(50% - 3px)';
    thumb.style.transform = next === 'chat' ? 'translateX(100%)' : 'translateX(0)';
    panelEl.querySelector('#sai-assist-view').style.display = next === 'assist' ? 'flex' : 'none';
    panelEl.querySelector('#sai-chat-view').style.display = next === 'chat' ? 'flex' : 'none';
    inputEl.placeholder = next === 'assist' ? '指示を入力…（例: 雑談チャンネルに切り替えて）' : 'メッセージを入力…';
    if (micBtn) micBtn.style.display = recognizer ? 'flex' : 'none';
  }

  function openPanel(triggerBtn) {
    panelEl.style.display = 'flex';
    if (bridge.popModalFrom) bridge.popModalFrom(panelEl, triggerBtn);
    setTimeout(() => inputEl && inputEl.focus(), 260);
  }
  function closePanel() {
    if (bridge.closeModal) bridge.closeModal(panelEl);
    else panelEl.style.display = 'none';
    stopListening();
  }

  /* ------------------------------------------------------------------ */
  /* 会話モード：履歴の保存/表示                                            */
  /* ------------------------------------------------------------------ */
  function loadChatHistory() {
    try { chatHistory = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'); } catch (_) { chatHistory = []; }
  }
  function saveChatHistory() {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(chatHistory.slice(-40))); } catch (_) {}
  }
  function textOf(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return '';
  }
  function renderChat() {
    if (!chatHistory.length) { chatScrollEl.innerHTML = '<div class="sai-chat-empty">AIと自由に会話できます（APIキー未設定時はSIGNALのFAQに簡易回答）</div>'; return; }
    chatScrollEl.innerHTML = '';
    chatHistory.forEach((m) => appendBubble(m.role === 'user' ? 'sai-user' : 'sai-ai', textOf(m.content)));
  }
  function appendBubble(cls, text) {
    const div = document.createElement('div');
    div.className = 'sai-msg ' + cls;
    div.textContent = text;
    chatScrollEl.appendChild(div);
    chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
    return div;
  }

  /* ------------------------------------------------------------------ */
  /* 送信ハンドラ                                                          */
  /* ------------------------------------------------------------------ */
  function handleSend() {
    const text = inputEl.value.trim();
    if (!text || busy) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (mode === 'assist') runAssist(text);
    else runChat(text);
  }

  /* ------------------------------------------------------------------ */
  /* APIなしモード（オフライン応答）                                          */
  /* APIキーが未設定の場合、またはAPI呼び出しが失敗した場合に自動的にこちらへ     */
  /* 切り替わる。SIGNAL自体の使い方についてのFAQと、簡単な操作コマンドの解釈を   */
  /* ルールベースで行う（ネットワーク通信なし・即時応答）。                     */
  /* ------------------------------------------------------------------ */
  const LOCAL_FAQ = [
    { kw: ['signal', 'シグナル', 'このアプリ', 'アプリって', 'とは'], a: 'SIGNALは複数人でリアルタイムに話せるグループチャットアプリだよ。チャンネルとDM、フレンド機能があって、画像やファイルの送信、アンケート、送信予約なんかも使えるよ。' },
    { kw: ['チャンネル'], a: 'サイドバーの「チャンネル」タブから切り替えられるよ。＋ボタンで新しいチャンネルも作れる。名前はチャンネルごとに個人設定（自分だけ）か全体設定（管理者用）で変更できるよ。' },
    { kw: ['dm', 'ダイレクト', '個人チャット'], a: 'DMはフレンドになった相手とだけ話せる1対1のチャットだよ。サイドバーの「DM」タブか、相手のプロフィールから開けるよ。' },
    { kw: ['フレンド', '友達', '友だち'], a: 'トップの「フレンド」ボタンから追加できるよ。空欄で検索すると全ユーザーが一覧で出てくる。表示名か@から始まるユーザー名で検索できるよ。' },
    { kw: ['メンション', '@'], a: 'メッセージ入力欄で「@」を打つと、メンションできる相手の候補が出てくるよ。名前をタップすれば自動で挿入されるよ。' },
    { kw: ['画像', '写真'], a: '入力欄の＋ボタンから「画像を送信」を選べば画像を送れるよ。認証バッジの種類によって自動で圧縮率が変わって、画像は7日で自動的に消えるよ（テキストは残る）。' },
    { kw: ['ファイル', '添付'], a: '＋ボタンの「ファイルを送信」から、画像以外の任意のファイルも送れるよ。' },
    { kw: ['アンケート', '投票'], a: '＋ボタンの「アンケートを作成」から質問と選択肢を決めて作れるよ。自由記述を許可するかも選べる。' },
    { kw: ['送信予約', '予約投稿', 'スケジュール'], a: '＋ボタンの「送信予約」から日時を指定してメッセージを予約できるよ。予約中のものはトップバーの⏰から確認できる。' },
    { kw: ['検索'], a: 'トップバー右上の虫眼鏡アイコンからチャット内のメッセージを検索できるよ。' },
    { kw: ['認証', 'バッジ', '金認証', '青認証'], a: '認証バッジには金・青などの種類があって、画像の圧縮率や一部機能（金認証専用チャンネルへの投稿など）に影響するよ。' },
    { kw: ['設定', 'テーマ', '配色', 'カラー', 'ダークモード'], a: '⚙（設定）から配色プリセットの切り替えや、UIの角丸・不透明度・スケール調整、コンパクト表示、モーション量なんかを細かく変更できるよ。' },
    { kw: ['mod', 'モッド'], a: '設定内のMOD機能から、.sxg形式のファイルを読み込んでUIや動作を拡張できるよ。おかしくなったときはセーフモードでMODを止めて起動できる。' },
    { kw: ['テトリス', '卓球', 'トランプ', 'ゲーム', 'ミニゲーム'], a: 'ゲームピッカーからテトリス99・卓球・トランプ（大富豪/ババ抜き/七並べ）で遊べるよ。マルチプレイ対応してる。' },
    { kw: ['管理者', 'admin', '停止'], a: '管理者パネルからチャンネルの全体管理や、必要に応じてアカウントの利用停止なんかができるよ。' },
    { kw: ['既読', '通知'], a: 'メッセージの既読状況や通知バナーの設定は、各チャット・設定画面から確認・変更できるよ。' },
  ];
  function localFaqAnswer(text) {
    const q = text.toLowerCase();
    let best = null, bestScore = 0;
    for (const entry of LOCAL_FAQ) {
      const score = entry.kw.reduce((n, k) => n + (q.includes(k.toLowerCase()) ? 1 : 0), 0);
      if (score > bestScore) { best = entry; bestScore = score; }
    }
    return best ? best.a : null;
  }
  /** アシストモード用：APIなしでも実行できる操作（切替・送信・パネル表示）をルールベースで解釈する */
  function localAssistIntent(text) {
    const channels = bridge.getChannels();
    const friends = bridge.getFriends();
    const hit = (list, keyFn) => list.find((x) => { const k = keyFn(x); return k && text.includes(k); });
    if (/(設定|せってい)/.test(text) && /(開|ひらい)/.test(text)) { bridge.openSettings(); return '設定を開いたよ。'; }
    if (/フレンド/.test(text) && /(開|ひらい|一覧)/.test(text)) { bridge.openFriends(); return 'フレンド一覧を開いたよ。'; }
    if (/(要約|まとめて)/.test(text)) {
      const recent = bridge.getRecentMessages(8);
      if (!recent.length) return '直近のメッセージが見当たらないよ。';
      return '直近のやりとりはこんな感じ：\n' + recent.map((m) => `・${m.mine ? '自分' : m.name}: ${(m.text || '').slice(0, 40)}`).join('\n');
    }
    const ch = hit(channels, (c) => c.name || c.id);
    if (ch && /(切替|切り替|移動|開)/.test(text)) { bridge.selectChannel(ch.id, ch.name); return `「${ch.name || ch.id}」に切り替えたよ。`; }
    const fr = hit(friends, (f) => f.name);
    if (fr && /(dm|でぃーえむ|話|開|切替|切り替)/.test(text)) { bridge.selectDm(fr.uid, fr.name); return `${fr.name}とのDMを開いたよ。`; }
    const faq = localFaqAnswer(text);
    if (faq) return faq;
    return 'ごめん、APIキーが未設定だからこの内容には答えられないよ。⚙で設定すると本格的なAIアシストが使えるよ。';
  }
  function ensureLocalNotice() {
    if (localNoticeShown) return;
    localNoticeShown = true;
    appendBubble('sai-error', 'APIキー未設定のため、簡易のオフライン応答（SIGNALのFAQ＋基本操作のみ）で動作しています。⚙から設定すると自由に会話できます。');
  }

  /* ------------------------------------------------------------------ */
  /* API呼び出し（共通）                                                    */
  /* ------------------------------------------------------------------ */
  async function callClaude(body) {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': getApiKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(Object.assign({ model: getModel(), max_tokens: 1024 }, body)),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`APIエラー (${resp.status}): ${t.slice(0, 200) || resp.statusText}`);
    }
    return resp;
  }

  /* ------------------------------------------------------------------ */
  /* 会話モード：ストリーミング応答                                          */
  /* ------------------------------------------------------------------ */
  async function runChat(userText) {
    busy = true; sendBtn.disabled = true;
    appendBubble('sai-user', userText);
    chatHistory.push({ role: 'user', content: userText });

    // APIキーが無ければ最初からオフラインFAQで応答（通信は行わない）
    if (!getApiKey()) {
      ensureLocalNotice();
      const answer = localFaqAnswer(userText) || 'ごめん、APIキーが未設定だとこの内容には答えられないよ。⚙で設定すると自由に会話できるよ。';
      appendBubble('sai-ai', answer);
      chatHistory.push({ role: 'assistant', content: answer });
      saveChatHistory();
      busy = false; sendBtn.disabled = false;
      return;
    }

    const aiDiv = appendBubble('sai-ai', '');
    const cursor = document.createElement('span');
    cursor.className = 'sai-cursor';
    aiDiv.appendChild(cursor);
    let full = '';
    try {
      const resp = await callClaude({
        system: 'あなたはSIGNALというチャットアプリに組み込まれた、親しみやすい日本語のAIアシスタントです。簡潔で自然な口語体で答えてください。',
        messages: chatHistory.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          let evt;
          try { evt = JSON.parse(jsonStr); } catch (_) { continue; }
          if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
            full += evt.delta.text;
            aiDiv.textContent = full;
            aiDiv.appendChild(cursor);
            chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
          }
        }
      }
      cursor.remove();
      chatHistory.push({ role: 'assistant', content: full || '(応答なし)' });
      saveChatHistory();
    } catch (err) {
      cursor.remove();
      aiDiv.remove();
      console.warn('[SIGNAL AI] API呼び出しに失敗、オフライン応答に切り替えます', err);
      ensureLocalNotice();
      const answer = localFaqAnswer(userText) || `（API接続に失敗したためオフライン応答だよ：${String(err.message || err).slice(0, 60)}）`;
      appendBubble('sai-ai', answer);
      chatHistory.push({ role: 'assistant', content: answer });
      saveChatHistory();
    } finally {
      busy = false; sendBtn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* アシストモード：ツール呼び出しループ                                      */
  /* ------------------------------------------------------------------ */
  const ASSIST_SYSTEM = 'あなたはチャットアプリ『SIGNAL』に組み込まれた音声アシスタントです。' +
    'ユーザーの短い指示を解釈し、必要であれば提供されたツールを使って実際に操作を実行してください。' +
    '操作が終わったら、日本語で1〜2文の短い口語体で結果を報告してください。前置きや敬語の定型文は不要です。' +
    'ツールで実行できない一般的な質問や雑談にも、簡潔に答えてください。';

  const TOOLS = [
    { name: 'list_channels', description: 'SIGNAL内のチャンネル一覧を取得する', input_schema: { type: 'object', properties: {} } },
    { name: 'list_friends', description: 'DM可能なフレンド一覧を取得する', input_schema: { type: 'object', properties: {} } },
    { name: 'switch_channel', description: '指定した名前に一致・類似するチャンネルに切り替える', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'チャンネル名（部分一致可）' } }, required: ['name'] } },
    { name: 'switch_dm', description: '指定した名前のフレンドとのDMに切り替える', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'フレンドの表示名（部分一致可）' } }, required: ['name'] } },
    { name: 'send_message', description: '現在開いている会話にメッセージを送信する', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'get_recent_messages', description: '現在開いている会話の直近のメッセージを取得する。要約や「誰が何を言った」等の質問に使う', input_schema: { type: 'object', properties: { count: { type: 'number', description: '取得件数（省略時20）' } } } },
    { name: 'open_settings', description: '設定画面を開く', input_schema: { type: 'object', properties: {} } },
    { name: 'open_friends', description: 'フレンド一覧画面を開く', input_schema: { type: 'object', properties: {} } },
  ];

  function fuzzyFind(list, q, keyFn) {
    if (!q) return null;
    const qq = q.trim().toLowerCase();
    if (!qq) return null;
    return list.find((x) => (keyFn(x) || '').toLowerCase() === qq)
      || list.find((x) => (keyFn(x) || '').toLowerCase().includes(qq))
      || list.find((x) => keyFn(x) && qq.includes((keyFn(x) || '').toLowerCase()));
  }

  async function executeTool(name, input) {
    try {
      switch (name) {
        case 'list_channels':
          return bridge.getChannels().map((c) => ({ id: c.id, name: c.name || c.id }));
        case 'list_friends':
          return bridge.getFriends();
        case 'switch_channel': {
          const list = bridge.getChannels();
          const target = fuzzyFind(list, input.name, (c) => c.name || c.id);
          if (!target) return { ok: false, error: '該当するチャンネルが見つかりません' };
          bridge.selectChannel(target.id, target.name);
          return { ok: true, switchedTo: target.name || target.id };
        }
        case 'switch_dm': {
          const list = bridge.getFriends();
          const target = fuzzyFind(list, input.name, (f) => f.name);
          if (!target) return { ok: false, error: '該当するフレンドが見つかりません' };
          bridge.selectDm(target.uid, target.name);
          return { ok: true, switchedTo: target.name };
        }
        case 'send_message':
          if (!input.text) return { ok: false, error: 'textが空です' };
          bridge.sendText(input.text);
          return { ok: true };
        case 'get_recent_messages':
          return bridge.getRecentMessages(input.count || 20);
        case 'open_settings':
          bridge.openSettings();
          return { ok: true };
        case 'open_friends':
          bridge.openFriends();
          return { ok: true };
        default:
          return { ok: false, error: '不明な操作です' };
      }
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  function setOrbState(state) {
    orbEl.classList.remove('sai-thinking', 'sai-listening');
    if (state) orbEl.classList.add(state);
  }
  function showCaption(text, placeholder) {
    capEl.textContent = text;
    capEl.classList.toggle('sai-placeholder', !!placeholder);
  }

  async function runAssist(userText) {
    busy = true; sendBtn.disabled = true;
    suggestEl.style.display = 'none';
    showCaption(userText);
    setOrbState('sai-thinking');

    // APIキーが無ければ最初からオフラインのルールベース処理（通信は行わない）
    if (!getApiKey()) {
      const answer = localAssistIntent(userText);
      showCaption(answer);
      speak(answer);
      setOrbState(null);
      busy = false; sendBtn.disabled = false;
      setTimeout(() => { suggestEl.style.display = 'flex'; }, 200);
      return;
    }

    const messages = [{ role: 'user', content: userText }];
    let guard = 0;
    try {
      while (guard++ < 5) {
        const resp = await callClaude({ system: ASSIST_SYSTEM, messages, tools: TOOLS });
        const data = await resp.json();
        const blocks = data.content || [];
        const toolUses = blocks.filter((b) => b.type === 'tool_use');
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (!toolUses.length) {
          showCaption(text || '（応答がありませんでした）');
          speak(text);
          setOrbState(null);
          break;
        }
        messages.push({ role: 'assistant', content: blocks });
        const toolResults = [];
        for (const tu of toolUses) {
          const result = await executeTool(tu.name, tu.input || {});
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
        }
        messages.push({ role: 'user', content: toolResults });
        if (data.stop_reason !== 'tool_use') {
          showCaption(text || '完了しました');
          speak(text);
          setOrbState(null);
          break;
        }
      }
    } catch (err) {
      console.warn('[SIGNAL AI] API呼び出しに失敗、オフライン応答に切り替えます', err);
      const answer = localAssistIntent(userText);
      showCaption(answer);
      speak(answer);
      setOrbState(null);
    } finally {
      busy = false; sendBtn.disabled = false;
      setTimeout(() => { suggestEl.style.display = 'flex'; }, 200);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 音声入力・音声出力（対応ブラウザのみ）                                     */
  /* ------------------------------------------------------------------ */
  function setupSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognizer = new SR();
      recognizer.lang = 'ja-JP';
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 1;
      recognizer.onresult = (e) => {
        const t = e.results[0][0].transcript;
        inputEl.value = t;
        handleSend();
      };
      recognizer.onend = () => { listening = false; micBtn.classList.remove('sai-listening'); setOrbState(null); };
      recognizer.onerror = () => { listening = false; micBtn.classList.remove('sai-listening'); setOrbState(null); };
      micBtn.style.display = mode === 'assist' ? 'flex' : 'none';
      micBtn.addEventListener('click', () => {
        if (listening) { stopListening(); return; }
        listening = true;
        micBtn.classList.add('sai-listening');
        setOrbState('sai-listening');
        try { recognizer.start(); } catch (_) {}
      });
    }
  }
  function stopListening() {
    if (recognizer && listening) { try { recognizer.stop(); } catch (_) {} }
    listening = false;
    if (micBtn) micBtn.classList.remove('sai-listening');
  }
  function speak(text) {
    if (!voiceEnabled() || !text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }
})();
