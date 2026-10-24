import './style.css';
import { FaceAnimator } from './face/animator';
import { FaceRenderer } from './face/renderer';
import { DemoDriver } from './demo';
import { Conversation, TokenError, type ConversationState, type TranscriptUpdate } from './live/conversation';
import { loadSettings, saveSettings, VOICES, type Settings } from './settings';
import { TOOL_LABELS } from './tools';

interface Health {
  model: string;
  hasGoogleKey: boolean;
  searchProvider: 'google' | 'openrouter';
  passwordRequired: boolean;
}

const STATUS_TEXT: Record<ConversationState, string> = {
  idle: 'Toque no microfone para conversar',
  connecting: 'Conectando…',
  listening: 'Pode falar',
  user_speaking: 'Ouvindo você…',
  thinking: 'Pensando…',
  speaking: 'Falando',
  reconnecting: 'Reconectando…',
  error: 'Algo deu errado',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = document.querySelector<HTMLElement>('.app')!;
const statusEl = $('status');
const talkBtn = $<HTMLButtonElement>('talkBtn');
const muteBtn = $<HTMLButtonElement>('muteBtn');
const transcriptBtn = $<HTMLButtonElement>('transcriptBtn');
const transcriptEl = $('transcript');
const messagesEl = $<HTMLOListElement>('messages');
const textForm = $<HTMLFormElement>('textForm');
const textInput = $<HTMLInputElement>('textInput');
const toolChip = $('toolChip');
const toastEl = $('toast');
const settingsDialog = $<HTMLDialogElement>('settings');
const settingsForm = $<HTMLFormElement>('settingsForm');

let settings: Settings = loadSettings();
let health: Health = { model: '', hasGoogleKey: true, searchProvider: 'google', passwordRequired: false };
let conversation: Conversation | null = null;
let restingState: ConversationState = 'idle';
let wakeLock: WakeLockSentinel | null = null;
const demo = new URLSearchParams(location.search).has('demo') ? new DemoDriver() : null;

// ── Rosto ──────────────────────────────────────────────────────────────

const renderer = new FaceRenderer($<HTMLCanvasElement>('face'));
const animator = new FaceAnimator();
let lastFrame = performance.now();
let shownState: ConversationState | null = null;

function frame(now: number): void {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  let state: ConversationState = conversation?.state ?? restingState;
  let level = conversation?.audio.outputLevel() ?? 0;
  if (demo && !conversation) ({ state, level } = demo.sample(now / 1000));

  renderer.draw(animator.update(state, now / 1000, dt, level));
  if (state !== shownState) {
    shownState = state;
    document.body.dataset.state = state;
    statusEl.textContent = demo && !conversation ? `Demonstração · ${STATUS_TEXT[state]}` : STATUS_TEXT[state];
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Conversa ───────────────────────────────────────────────────────────

async function startConversation(): Promise<void> {
  if (!health.hasGoogleKey) {
    toast('O servidor está sem GOOGLE_API_KEY. Configure na Vercel e faça o deploy de novo.', 'error');
    return;
  }
  if (health.passwordRequired && !settings.password) {
    toast('Este app pede senha. Digite nas configurações.');
    openSettings();
    return;
  }

  restingState = 'idle';
  const current = new Conversation({
    settings,
    searchProvider: health.searchProvider,
    callbacks: {
      onTranscript: renderTranscript,
      onTool: showTool,
      onError: (message) => {
        restingState = 'error';
        toast(message, 'error');
      },
      onNotice: (message) => toast(message),
      onEnded: (reason) => {
        if (conversation === current) conversation = null;
        if (reason === 'timeout') toast('Conversa encerrada depois de 30 minutos. Toque para começar outra.');
        setActiveUi(false);
      },
    },
  });
  conversation = current;
  setActiveUi(true);
  talkBtn.disabled = true;
  try {
    await current.start();
  } catch (error) {
    conversation = null;
    setActiveUi(false);
    restingState = 'error';
    toast(describeStartError(error), 'error');
    if (error instanceof TokenError && error.status === 401) openSettings();
  } finally {
    talkBtn.disabled = false;
  }
}

function describeStartError(error: unknown): string {
  if (error instanceof TokenError) return error.message;
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Sem permissão para usar o microfone. Libere nas configurações do navegador.';
    if (error.name === 'NotFoundError') return 'Nenhum microfone encontrado neste aparelho.';
  }
  return `Não consegui iniciar a conversa: ${error instanceof Error ? error.message : String(error)}`;
}

function setActiveUi(active: boolean): void {
  talkBtn.setAttribute('aria-pressed', String(active));
  talkBtn.setAttribute('aria-label', active ? 'Encerrar conversa' : 'Começar conversa');
  muteBtn.disabled = !active;
  muteBtn.setAttribute('aria-pressed', 'false');
  textInput.disabled = !active;
  textForm.querySelector('button')!.disabled = !active;
  if (!active) showTool('', 'done');
  void (active ? lockScreen() : releaseScreen());
}

talkBtn.addEventListener('click', () => {
  if (conversation) void conversation.stop();
  else void startConversation();
});

muteBtn.addEventListener('click', () => {
  if (!conversation) return;
  const muted = !conversation.audio.isMuted;
  conversation.setMuted(muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', muted ? 'Ativar microfone' : 'Silenciar microfone');
});

textForm.addEventListener('submit', (event) => {
  event.preventDefault();
  conversation?.sendText(textInput.value);
  textInput.value = '';
});

// ── Transcrição ────────────────────────────────────────────────────────

const bubbles = new Map<number, HTMLLIElement>();

function renderTranscript(entry: TranscriptUpdate): void {
  messagesEl.querySelector('.empty')?.remove();
  let li = bubbles.get(entry.id);
  if (!li) {
    li = document.createElement('li');
    bubbles.set(entry.id, li);
    messagesEl.append(li);
    while (bubbles.size > 200) {
      const [oldest, el] = bubbles.entries().next().value!;
      el.remove();
      bubbles.delete(oldest);
    }
  }
  li.className = `msg ${entry.role}${entry.done ? '' : ' partial'}${entry.interrupted ? ' interrupted' : ''}`;
  li.textContent = entry.text.trim();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setTranscriptOpen(open: boolean): void {
  transcriptEl.dataset.open = String(open);
  app.dataset.transcript = String(open);
  transcriptBtn.setAttribute('aria-expanded', String(open));
  try {
    localStorage.setItem('live-voz:transcript', open ? '1' : '0');
  } catch {
    // sem armazenamento
  }
}

transcriptBtn.addEventListener('click', () => setTranscriptOpen(transcriptEl.dataset.open !== 'true'));
$('closeTranscript').addEventListener('click', () => setTranscriptOpen(false));
try {
  if (localStorage.getItem('live-voz:transcript') === '1' && matchMedia('(min-width: 1000px)').matches) {
    setTranscriptOpen(true);
  }
} catch {
  // sem armazenamento
}

// ── Ferramentas e avisos ───────────────────────────────────────────────

let toolTimer: ReturnType<typeof setTimeout> | undefined;

function showTool(name: string, status: 'running' | 'done' | 'error'): void {
  clearTimeout(toolTimer);
  if (!name || status === 'done') {
    toolChip.hidden = true;
    return;
  }
  toolChip.dataset.status = status;
  toolChip.textContent = status === 'error' ? `${TOOL_LABELS[name] ?? name}: falhou` : `${TOOL_LABELS[name] ?? name}…`;
  toolChip.hidden = false;
  if (status === 'error') toolTimer = setTimeout(() => (toolChip.hidden = true), 3000);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.dataset.kind = kind;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 7000 : 4000);
}

// ── Configurações ──────────────────────────────────────────────────────

const voiceSelect = settingsForm.elements.namedItem('voice') as HTMLSelectElement;
for (const voice of VOICES) voiceSelect.add(new Option(voice.label, voice.id));

function openSettings(): void {
  const fields = settingsForm.elements;
  (fields.namedItem('name') as HTMLInputElement).value = settings.name;
  voiceSelect.value = settings.voice;
  (fields.namedItem('extraInstructions') as HTMLTextAreaElement).value = settings.extraInstructions;
  (fields.namedItem('password') as HTMLInputElement).value = settings.password;
  $('passwordField').hidden = !health.passwordRequired;
  settingsDialog.showModal();
}

$('settingsBtn').addEventListener('click', openSettings);

settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue !== 'save') return;
  const data = new FormData(settingsForm);
  settings = {
    name: String(data.get('name') ?? '').trim() || settings.name,
    voice: String(data.get('voice') ?? settings.voice),
    extraInstructions: String(data.get('extraInstructions') ?? ''),
    password: String(data.get('password') ?? settings.password),
  };
  saveSettings(settings);
  toast(conversation ? 'Salvo. Vale a partir da próxima conversa.' : 'Configurações salvas.');
});

// ── Tela ligada e volta do segundo plano ───────────────────────────────

async function lockScreen(): Promise<void> {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

async function releaseScreen(): Promise<void> {
  await wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !conversation) return;
  void conversation.audio.resume();
  if (!wakeLock || wakeLock.released) void lockScreen();
});

// ── Início ─────────────────────────────────────────────────────────────

fetch('/api/health')
  .then((response) => (response.ok ? (response.json() as Promise<Health>) : Promise.reject(response.status)))
  .then((data) => {
    health = data;
  })
  .catch(() => {
    if (!demo) toast('Não consegui falar com o servidor (/api/health).', 'error');
  });
