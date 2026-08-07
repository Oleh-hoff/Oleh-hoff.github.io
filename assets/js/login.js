/* ==========================================================================
   Сборка страницы входа
   ========================================================================== */

import { applyTranslations, bindLangControls, onLangChange, t } from './i18n.js';
import { initTheme, bindThemeControls } from './theme.js';
import { signIn, redirectIfAuthed, isCryptoAvailable, lockoutRemaining } from './auth.js';

initTheme();
bindThemeControls(document.getElementById('theme-controls'));
bindLangControls(document.querySelector('.auth__toolbar'));
applyTranslations();

// Живая сессия — внутрь, минуя форму
redirectIfAuthed('app.html');

const form = document.getElementById('login-form');
const loginInput = document.getElementById('login');
const passwordInput = document.getElementById('password');
const rememberInput = document.getElementById('remember');
const trapInput = document.getElementById('company');
const submitButton = document.getElementById('submit');
const errorBox = document.getElementById('login-error');
const errorText = document.getElementById('login-error-text');
const toggleButton = document.getElementById('toggle-password');

/* --- Показать / скрыть пароль ------------------------------------------ */

toggleButton.addEventListener('click', () => {
  const shown = passwordInput.type === 'text';
  passwordInput.type = shown ? 'password' : 'text';
  const key = shown ? 'auth.showPassword' : 'auth.hidePassword';
  toggleButton.setAttribute('aria-label', t(key));
  toggleButton.setAttribute('title', t(key));
  passwordInput.focus();
});

/* --- Ошибки ------------------------------------------------------------- */

let errorKey = null;
let errorVars = null;

function showError(key, vars) {
  errorKey = key;
  errorVars = vars;
  errorText.textContent = t(key, vars);
  errorBox.hidden = false;
  loginInput.setAttribute('aria-invalid', 'true');
  passwordInput.setAttribute('aria-invalid', 'true');
}

function clearError() {
  errorKey = null;
  errorBox.hidden = true;
  loginInput.removeAttribute('aria-invalid');
  passwordInput.removeAttribute('aria-invalid');
}

// При смене языка уже показанная ошибка должна переехать вместе с интерфейсом
onLangChange(() => {
  if (errorKey) errorText.textContent = t(errorKey, errorVars);
  const key = passwordInput.type === 'text' ? 'auth.hidePassword' : 'auth.showPassword';
  toggleButton.setAttribute('aria-label', t(key));
  toggleButton.setAttribute('title', t(key));
});

[loginInput, passwordInput].forEach((input) => {
  input.addEventListener('input', () => { if (errorKey) clearError(); });
});

/* --- Обратный отсчёт паузы после серии неудач --------------------------- */

let countdownTimer = null;

function startCountdown() {
  clearInterval(countdownTimer);
  const tick = () => {
    const left = lockoutRemaining();
    if (left <= 0) {
      clearInterval(countdownTimer);
      submitButton.disabled = false;
      clearError();
      return;
    }
    submitButton.disabled = true;
    showError('auth.errorLocked', { sec: left });
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

if (lockoutRemaining() > 0) startCountdown();

/* --- Отправка ----------------------------------------------------------- */

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  // Заполненная ловушка = бот. Молча делаем вид, что всё как обычно.
  if (trapInput.value) {
    showError('auth.errorInvalid');
    return;
  }

  const login = loginInput.value.trim();
  const password = passwordInput.value;

  if (!login || !password) {
    showError('auth.errorEmpty');
    (login ? passwordInput : loginInput).focus();
    return;
  }

  if (!isCryptoAvailable()) {
    errorText.textContent = 'WebCrypto недоступен. Откройте сайт по https:// —'
      + ' на http:// браузер отключает криптографию.';
    errorBox.hidden = false;
    return;
  }

  clearError();
  submitButton.disabled = true;
  submitButton.textContent = t('auth.submitting');

  const result = await signIn(login, password, rememberInput.checked);

  if (result.ok) {
    location.replace('app.html');
    return;
  }

  submitButton.disabled = false;
  submitButton.textContent = t('auth.submit');

  if (result.reason === 'locked') {
    startCountdown();
  } else {
    showError('auth.errorInvalid');
    passwordInput.select();
  }
});
