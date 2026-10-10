'use strict';

const PRICE = 200;
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const formatMoney = value => `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
const formatDate = value => {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString('fr-FR');
};
const normalizePhone = value => String(value || '').replace(/\D/g, '');

let cartQty = 0;
let setupRequired = true;
let loggedIn = false;
let dashboardData = { orders: [], customers: [], settings: { whatsapp: '', minPurchase: 4, threshold: 10 }, stats: {} };

async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
  return data;
}
function showMessage(target, message, type = 'info') {
  const element = typeof target === 'string' ? $(target) : target;
  element.className = `message ${type}`;
  element.textContent = message;
  element.classList.remove('hidden');
}
function clearMessage(target) {
  const element = typeof target === 'string' ? $(target) : target;
  element.textContent = '';
  element.className = 'message hidden';
}
function showInline(target, message, type = 'success') {
  const element = $(target);
  element.className = type === 'error' ? 'message error' : 'success';
  element.textContent = message;
  element.classList.remove('hidden');
}
function setTab(tab) {
  const isStudent = tab === 'student';
  $('studentView').classList.toggle('hidden', !isStudent);
  $('adminView').classList.toggle('hidden', isStudent);
  $('studentTab').classList.toggle('active', isStudent);
  $('adminTab').classList.toggle('active', !isStudent);
  clearMessage('globalMessage');
  if (!isStudent) openAdminSection();
}
$('studentTab').addEventListener('click', () => setTab('student'));
$('adminTab').addEventListener('click', () => setTab('admin'));

function renderCart() {
  if (cartQty > 0) {
    $('cartLines').innerHTML = `
      <div class="cart-line">
        <div><strong>Gaufres au chocolat</strong><div class="muted">${formatMoney(PRICE)} l’unité</div></div>
        <div class="qty-controls">
          <button type="button" class="secondary" data-cart-change="-1" aria-label="Retirer une gaufre">−</button>
          <strong>${cartQty}</strong>
          <button type="button" data-cart-change="1" aria-label="Ajouter une gaufre">+</button>
        </div>
      </div>`;
  } else {
    $('cartLines').innerHTML = '<div class="empty">Ton panier est vide.</div>';
  }
  $('cartTotal').textContent = `Total : ${formatMoney(cartQty * PRICE)}`;
  $('whatsappOrder').disabled = cartQty < 1;
}
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
  cartQty = Math.min(100, cartQty + Number(button.dataset.add || 1));
  renderCart();
}));
$('cartLines').addEventListener('click', event => {
  const button = event.target.closest('[data-cart-change]');
  if (!button) return;
  cartQty = Math.max(0, Math.min(100, cartQty + Number(button.dataset.cartChange)));
  renderCart();
});

$('studentOrderForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (cartQty < 1) return showInline('orderFeedback', 'Ajoute au moins une gaufre au panier.', 'error');
  const name = $('studentName').value.trim();
  if (!name) return showInline('orderFeedback', 'Entre ton nom ou ton surnom.', 'error');

  // Open a blank tab directly from the click so browser popup blockers are less likely to block WhatsApp.
  const whatsappWindow = window.open('about:blank', '_blank');
  const button = $('whatsappOrder');
  button.disabled = true;
  button.textContent = 'Enregistrement…';
  $('orderFeedback').textContent = '';
  try {
    const payload = {
      name,
      phone: $('studentPhone').value.trim(),
      qty: cartQty,
      pickup: $('pickup').value,
      notes: $('details').value.trim()
    };
    const response = await api('/api/public/orders', { method: 'POST', body: JSON.stringify(payload) });
    const order = response.order;
    const message = [
      'Bonjour Choco Campus ! Je souhaite commander :',
      '',
      `Référence : ${order.id.slice(0, 8)}`,
      `Nom : ${payload.name}`,
      `Gaufres au chocolat : ${payload.qty}`,
      `Total : ${formatMoney(order.total)}`,
      `Retrait souhaité : ${payload.pickup}`,
      `Mon numéro : ${payload.phone || 'Non indiqué'}`,
      `Précisions : ${payload.notes || 'Aucune'}`,
      '',
      'Merci de confirmer la disponibilité et l’heure de retrait.'
    ].join('\n');
    const whatsappUrl = `https://wa.me/${normalizePhone(response.whatsapp)}?text=${encodeURIComponent(message)}`;
    if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;
    else window.location.href = whatsappUrl;
    showInline('orderFeedback', `Commande ${order.id.slice(0, 8)} enregistrée dans la base de données. Termine l’envoi dans WhatsApp.`, 'success');
    cartQty = 0;
    renderCart();
    $('details').value = '';
  } catch (error) {
    if (whatsappWindow) whatsappWindow.close();
    showInline('orderFeedback', error.message, 'error');
  } finally {
    button.textContent = 'Commander par WhatsApp';
    button.disabled = cartQty < 1;
  }
});

async function checkAdminStatus() {
  const status = await api('/api/admin/status');
  setupRequired = status.setupRequired;
  return status;
}
function renderAuthForm() {
  const title = setupRequired ? 'Créer le premier compte admin' : 'Connexion admin';
  const intro = setupRequired
    ? 'C’est la première utilisation : choisis un nom admin et un mot de passe fort (8 caractères minimum).'
    : 'Saisis tes identifiants administrateur.';
  $('authFormHost').innerHTML = `
    <form id="authForm" class="auth-form">
      <h3>${title}</h3>
      <p class="muted">${intro}</p>
      <label for="authUsername">Nom admin</label>
      <input id="authUsername" name="username" minlength="3" maxlength="32" autocomplete="username" pattern="[A-Za-z0-9._-]{3,32}" required>
      <label for="authPassword">Mot de passe</label>
      <input id="authPassword" name="password" type="password" minlength="8" maxlength="200" autocomplete="${setupRequired ? 'new-password' : 'current-password'}" required>
      ${setupRequired ? '<label for="authPasswordConfirm">Confirmer le mot de passe</label><input id="authPasswordConfirm" type="password" minlength="8" maxlength="200" autocomplete="new-password" required>' : ''}
      <button class="full" type="submit">${setupRequired ? 'Créer le compte et entrer' : 'Se connecter'}</button>
      <div id="authFeedback" aria-live="polite"></div>
    </form>`;
  $('authForm').addEventListener('submit', submitAuthForm);
}
async function submitAuthForm(event) {
  event.preventDefault();
  const username = $('authUsername').value.trim();
  const password = $('authPassword').value;
  if (setupRequired && password !== $('authPasswordConfirm').value) {
    return showInline('authFeedback', 'Les deux mots de passe ne correspondent pas.', 'error');
  }
  const submitButton = $('authForm').querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await api(setupRequired ? '/api/admin/setup' : '/api/admin/login', {
      method: 'POST', body: JSON.stringify({ username, password })
    });
    loggedIn = true;
    await showDashboard();
  } catch (error) {
    showInline('authFeedback', error.message, 'error');
    try { await checkAdminStatus(); } catch { /* keep the form visible if the API is unavailable */ }
  } finally {
    const currentButton = $('authForm')?.querySelector('button[type="submit"]');
    if (currentButton) currentButton.disabled = false;
  }
}
async function openAdminSection() {
  $('adminAuthPanel').classList.remove('hidden');
  $('adminDashboard').classList.add('hidden');
  if (loggedIn) {
    try {
      await api('/api/admin/me');
      await showDashboard();
      return;
    } catch { loggedIn = false; }
  }
  try {
    await checkAdminStatus();
    renderAuthForm();
  } catch (error) {
    $('authFormHost').innerHTML = `<div class="message error">${escapeHtml(error.message)} Vérifie que le serveur Choco Campus est démarré.</div>`;
  }
}
async function showDashboard() {
  $('adminAuthPanel').classList.add('hidden');
  $('adminDashboard').classList.remove('hidden');
  loggedIn = true;
  await loadDashboard();
}
async function loadDashboard() {
  const data = await api('/api/admin/dashboard');
  dashboardData = data;
  $('sellerWhatsapp').value = data.settings.whatsapp || '';
  $('minPurchase').value = String(data.settings.minPurchase || 4);
  $('threshold').value = String(data.settings.threshold || 10);
  $('statOrders').textContent = data.stats.orders;
  $('statPending').textContent = data.stats.pending;
  $('statCustomers').textContent = data.stats.customers;
  renderOrders();
  renderCustomers();
}
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('settingsForm').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({
      whatsapp: $('sellerWhatsapp').value,
      minPurchase: Number($('minPurchase').value),
      threshold: Number($('threshold').value)
    }) });
    showInline('settingsFeedback', 'Paramètres enregistrés dans la base de données.', 'success');
    await loadDashboard();
  } catch (error) {
    showInline('settingsFeedback', error.message, 'error');
  } finally { button.disabled = false; }
});
$('manualOrderForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('manualOrderForm').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/admin/orders', { method: 'POST', body: JSON.stringify({
      name: $('manualName').value.trim(), phone: $('manualPhone').value.trim(),
      qty: Number($('manualQty').value), pickup: $('manualPickup').value, notes: $('manualNotes').value.trim()
    }) });
    $('manualName').value = '';
    $('manualPhone').value = '';
    $('manualQty').value = '4';
    $('manualNotes').value = '';
    await loadDashboard();
    showMessage('globalMessage', 'Commande enregistrée.', 'success');
  } catch (error) { showMessage('globalMessage', error.message, 'error'); }
  finally { button.disabled = false; }
});

function renderOrders() {
  const query = $('orderSearch').value.trim().toLocaleLowerCase('fr-FR');
  const orders = dashboardData.orders.filter(order => `${order.name} ${order.phone} ${order.status} ${order.id}`.toLocaleLowerCase('fr-FR').includes(query));
  if (!orders.length) {
    $('ordersList').innerHTML = '<div class="empty">Aucune commande correspondant à cette recherche.</div>';
    return;
  }
  $('ordersList').innerHTML = orders.map(order => {
    const statusClass = order.status === 'En attente' ? 'pending' : order.status === 'Annulée' ? 'cancel' : '';
    let buttons = '';
    if (order.status === 'En attente') {
      buttons += `<button type="button" class="green" data-action="status" data-id="${escapeHtml(order.id)}" data-status="En préparation">En préparation</button>`;
      buttons += `<button type="button" class="green" data-action="status" data-id="${escapeHtml(order.id)}" data-status="Livrée">Marquer livrée</button>`;
      buttons += `<button type="button" class="secondary" data-action="status" data-id="${escapeHtml(order.id)}" data-status="Annulée">Annuler</button>`;
    } else if (order.status === 'En préparation') {
      buttons += `<button type="button" class="green" data-action="status" data-id="${escapeHtml(order.id)}" data-status="Livrée">Marquer livrée</button>`;
      buttons += `<button type="button" class="secondary" data-action="status" data-id="${escapeHtml(order.id)}" data-status="Annulée">Annuler</button>`;
    }
    if (!order.loyalty_counted) buttons += `<button type="button" class="secondary" data-action="delete-order" data-id="${escapeHtml(order.id)}">Supprimer</button>`;
    const origin = order.source === 'student' ? 'Commande WhatsApp' : 'Saisie vendeur';
    return `<article class="order-card">
      <div class="order-head"><div><h3>${escapeHtml(order.name)} — ${order.qty} gaufre(s)</h3>
      <div class="muted">${escapeHtml(formatDate(order.created_at))} · ${escapeHtml(order.phone || 'Pas de téléphone')} · ${origin}</div>
      <div class="muted">Réf. ${escapeHtml(order.id.slice(0, 8))}</div></div>
      <span class="badge ${statusClass}">${escapeHtml(order.status)}</span></div>
      <p><strong>${formatMoney(order.total)}</strong> · Retrait : ${escapeHtml(order.pickup || 'À confirmer')}</p>
      ${order.notes ? `<p class="muted">${escapeHtml(order.notes)}</p>` : ''}
      ${order.loyalty_message ? `<p class="muted">${escapeHtml(order.loyalty_message)}</p>` : ''}
      <div class="actions">${buttons}</div>
    </article>`;
  }).join('');
}
function renderCustomers() {
  const query = $('customerSearch').value.trim().toLocaleLowerCase('fr-FR');
  const customers = dashboardData.customers.filter(customer => `${customer.name} ${customer.phone}`.toLocaleLowerCase('fr-FR').includes(query));
  if (!customers.length) {
    $('customersList').innerHTML = '<div class="empty">Aucun client fidélité pour le moment. Les clients apparaissent lorsqu’une commande est marquée comme livrée.</div>';
    return;
  }
  const threshold = Math.max(2, Number(dashboardData.settings.threshold) || 10);
  $('customersList').innerHTML = customers.map(customer => {
    const progress = customer.bought % threshold;
    const need = progress === 0 ? threshold : threshold - progress;
    const historyHtml = customer.history.map(entry => {
      if (entry.event_type === 'reward') return `<div>${escapeHtml(formatDate(entry.event_at))} : 🎁 récompense remise</div>`;
      const counted = entry.qualifies ? 'comptée' : 'non comptée';
      return `<div>${escapeHtml(formatDate(entry.event_at))} : ${entry.qty} gaufre(s) (${counted})${entry.rewards_earned ? ` · ${entry.rewards_earned} récompense(s) gagnée(s)` : ''}</div>`;
    }).join('') || '<div>Aucun historique.</div>';
    const pips = Array.from({ length: Math.min(threshold, 20) }, (_, index) => `<span class="pip ${index < progress ? 'filled' : ''}">${index < progress ? '✓' : ''}</span>`).join('');
    return `<article class="customer">
      <div class="order-head"><div><h3>${escapeHtml(customer.name)}</h3><div class="muted">${escapeHtml(customer.phone || 'Pas de téléphone')} · ${customer.bought} gaufre(s) comptée(s)</div></div>
      ${customer.rewards ? `<span class="badge">${customer.rewards} récompense(s) disponible(s)</span>` : ''}</div>
      <div class="pips">${pips}</div>
      <div class="progress"><div style="width:${progress / threshold * 100}%"></div></div>
      <p class="muted">${progress === 0 ? 'Cycle de fidélité au début.' : `${need} gaufre(s) comptée(s) avant la prochaine récompense.`}</p>
      <div class="actions"><button type="button" ${customer.rewards < 1 ? 'disabled' : ''} data-action="redeem" data-id="${escapeHtml(customer.id)}">🎁 Remettre une gaufre</button>
      <button type="button" class="secondary" data-action="history" data-id="${escapeHtml(customer.id)}">Historique</button></div>
      <div id="history-${escapeHtml(customer.id)}" class="muted inline-note hidden">${historyHtml}</div>
    </article>`;
  }).join('');
}
$('orderSearch').addEventListener('input', renderOrders);
$('customerSearch').addEventListener('input', renderCustomers);
$('ordersList').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, status } = button.dataset;
  if (action === 'history') return;
  button.disabled = true;
  try {
    if (action === 'status') {
      const result = await api(`/api/admin/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await loadDashboard();
      if (result.loyaltyMessage) {
        const rewardText = result.rewardsEarned ? ` Le client gagne ${result.rewardsEarned} gaufre(s) offerte(s) !` : '';
        showMessage('globalMessage', result.loyaltyMessage + rewardText, 'success');
      }
    } else if (action === 'delete-order') {
      if (!confirm('Supprimer cette commande ?')) return;
      await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadDashboard();
      showMessage('globalMessage', 'Commande supprimée.', 'success');
    }
  } catch (error) { showMessage('globalMessage', error.message, 'error'); }
  finally { if (button.isConnected) button.disabled = false; }
});
$('customersList').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'history') {
    $(`history-${CSS.escape(id)}`)?.classList.toggle('hidden');
    return;
  }
  if (action !== 'redeem') return;
  if (!confirm('Confirmer qu’une gaufre gratuite est remise à ce client ?')) return;
  button.disabled = true;
  try {
    await api(`/api/admin/customers/${encodeURIComponent(id)}/redeem`, { method: 'POST', body: JSON.stringify({}) });
    await loadDashboard();
    showMessage('globalMessage', 'Récompense enregistrée.', 'success');
  } catch (error) { showMessage('globalMessage', error.message, 'error'); }
  finally { if (button.isConnected) button.disabled = false; }
});
$('refreshAdmin').addEventListener('click', async () => {
  try { await loadDashboard(); showMessage('globalMessage', 'Tableau de bord actualisé.', 'success'); }
  catch (error) { showMessage('globalMessage', error.message, 'error'); }
});
$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) }); }
  catch { /* always return to the login form locally */ }
  loggedIn = false;
  await openAdminSection();
  showMessage('globalMessage', 'Déconnexion effectuée.', 'success');
});
$('exportData').addEventListener('click', () => {
  const backup = { exportedAt: new Date().toISOString(), version: 1, settings: dashboardData.settings, orders: dashboardData.orders, customers: dashboardData.customers };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `choco-campus-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

async function loadPublicSettings() {
  try {
    const settings = await api('/api/public/settings');
    $('setupNotice').classList.toggle('hidden', settings.whatsappConfigured);
  } catch {
    showMessage('globalMessage', 'Le site doit être lancé par le serveur Node.js. Suis les étapes du fichier README.md : ne double-clique pas directement sur index.html.', 'error');
  }
}
renderCart();
loadPublicSettings();
