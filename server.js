 // Product Catalog corresponding to your screenshot
 const PRODUCTS = {
     simple: { name: 'Gaufres Classiques', price: 100 },
     classic: { name: 'Gaufres au chocolat', price: 200 },
     pack3: { name: 'Pack de 3 Gaufres au chocolat', price: 900 },
     pack6: { name: 'Pack de 6 Gaufres au chocolat + (Une Gaufre Classique offerte 🎁)', price: 1500 }
 };

 let state = { whatsapp: '', minPurchase: 4, threshold: 10, orders: [], customers: [] };
 let cart = { simple: 0, classic: 0, pack3: 0, pack6: 0 };
 let isAdminLoggedIn = false;

 const $ = id => document.getElementById(id);

 function uid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }

 function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

 // Calculate total items and total price
 function getCartDetails() {
     let totalPrice = 0;
     let totalQty = 0;
     const lines = [];

     for (const [key, qty] of Object.entries(cart)) {
         if (qty > 0 && PRODUCTS[key]) {
             const item = PRODUCTS[key];
             const lineTotal = qty * item.price;
             totalPrice += lineTotal;

             // Calculate waffle quantity for loyalty tracking
             if (key === 'simple') totalQty += qty;
             else if (key === 'classic') totalQty += qty;
             else if (key === 'pack3') totalQty += qty * 3;
             else if (key === 'pack6') totalQty += qty * 7; // 6 + 1 free

             lines.push({
                 key,
                 name: item.name,
                 price: item.price,
                 qty,
                 lineTotal
             });
         }
     }

     return { totalPrice, totalQty, lines };
 }

 // Add product to cart
 window.addToCart = (type, qty = 1) => {
     cart[type] = (cart[type] || 0) + qty;
     renderCart();
 };

 // Change quantity from cart controls
 window.changeQty = (type, delta) => {
     cart[type] = Math.max(0, (cart[type] || 0) + delta);
     renderCart();
 };

 // Render Cart Breakdown and Sum Total
 function renderCart() {
     const { totalPrice, lines } = getCartDetails();

     if (lines.length === 0) {
         $('cartLines').innerHTML = '<div class="empty">Ton panier est vide.</div>';
     } else {
         $('cartLines').innerHTML = lines.map(line => `
            <div class="cart-line">
                <div>
                    <strong>${esc(line.name)}</strong>
                    <div class="muted">${line.price.toLocaleString('fr-FR')} FCFA l’unité</div>
                </div>
                <div class="qty-controls">
                    <button class="secondary" onclick="changeQty('${line.key}', -1)">−</button>
                    <strong>${line.qty}</strong>
                    <button onclick="changeQty('${line.key}', 1)">+</button>
                </div>
            </div>
        `).join('');
     }

     $('cartTotal').textContent = 'Total : ' + totalPrice.toLocaleString('fr-FR') + ' FCFA';
 }

 async function loadData() {
     try {
         const res = await fetch('/api/state');
         state = await res.json();
         if ($('sellerWhatsapp')) $('sellerWhatsapp').value = state.whatsapp || '';
         if ($('minPurchase')) $('minPurchase').value = String(state.minPurchase || 4);
         if ($('threshold')) $('threshold').value = String(state.threshold || 10);
         renderCart();
         if (isAdminLoggedIn) renderSeller();
     } catch (e) {
         console.error('Erreur de chargement des données', e);
     }
 }

 // Admin Login
 if ($('loginBtn')) {
     $('loginBtn').onclick = async() => {
         const password = $('adminPassword').value;
         try {
             const res = await fetch('/api/login', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ password })
             });
             const data = await res.json();
             if (data.success) {
                 isAdminLoggedIn = true;
                 $('loginPanel').classList.add('hidden');
                 $('adminDashboard').classList.remove('hidden');
                 renderSeller();
             } else {
                 $('loginFeedback').innerHTML = '<div style="background:#f8e1e1;border:1px solid #9c3434;border-radius:12px;padding:12px;margin-top:10px;font-size:13px;color:#9c3434">Mot de passe incorrect.</div>';
             }
         } catch (e) {
             alert('Erreur de connexion au serveur.');
         }
     };
 }

 if ($('adminPassword')) {
     $('adminPassword').addEventListener('keypress', (e) => {
         if (e.key === 'Enter') $('loginBtn').click();
     });
 }

 async function saveSettingsAPI() {
     const wa = normalizePhone($('sellerWhatsapp').value);
     if (wa.length < 8) { alert('Entre un numéro WhatsApp valide avec indicatif pays, sans + ni espaces.'); return; }
     state.whatsapp = wa;
     state.minPurchase = Number($('minPurchase').value);
     state.threshold = Number($('threshold').value);

     await fetch('/api/settings', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ whatsapp: state.whatsapp, minPurchase: state.minPurchase, threshold: state.threshold })
     });

     const newPwd = $('newAdminPassword').value.trim();
     if (newPwd) {
         if (newPwd.length < 4) {
             alert('Le mot de passe doit contenir au moins 4 caractères.');
             return;
         }
         await fetch('/api/password', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ newPassword: newPwd })
         });
         $('newAdminPassword').value = '';
         alert('Paramètres et nouveau mot de passe enregistrés !');
     } else {
         alert('Paramètres enregistrés.');
     }
 }

 async function saveOrderAPI(order) {
     await fetch('/api/orders', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(order)
     });
     await loadData();
 }

 async function deleteOrderAPI(id) {
     await fetch(`/api/orders/${id}`, { method: 'DELETE' });
     await loadData();
 }

 async function saveCustomerAPI(customer) {
     await fetch('/api/customers', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(customer)
     });
     await loadData();
 }

 function setTab(tab) {
     const student = tab === 'student';
     $('studentView').classList.toggle('hidden', !student);
     $('sellerView').classList.toggle('hidden', student);
     $('studentTab').classList.toggle('active', student);
     $('sellerTab').classList.toggle('active', !student);
     if (!student) {
         if (isAdminLoggedIn) renderSeller();
         else {
             $('loginPanel').classList.remove('hidden');
             $('adminDashboard').classList.add('hidden');
         }
     }
 }

 if ($('studentTab')) $('studentTab').onclick = () => setTab('student');
 if ($('sellerTab')) $('sellerTab').onclick = () => setTab('seller');

 function normalizePhone(s) { return String(s || '').replace(/\D/g, ''); }

 function findCustomer(name, phone) {
     const p = normalizePhone(phone);
     return state.customers.find(c => (p && normalizePhone(c.phone) === p) || (!p && c.name.toLowerCase() === name.toLowerCase()));
 }

 function ensureCustomer(name, phone) {
     let c = findCustomer(name, phone);
     if (!c) {
         c = { id: uid(), name, phone: phone || '', bought: 0, rewards: 0, history: [] };
         state.customers.push(c);
     } else {
         c.name = name || c.name;
         if (phone) c.phone = phone;
     }
     return c;
 }

 async function countLoyalty(name, phone, qty, orderId) {
     const c = ensureCustomer(name, phone);
     const qualifies = qty >= Number(state.minPurchase);
     let rewardsEarned = 0;
     if (qualifies) {
         const old = Math.floor(c.bought / Number(state.threshold));
         c.bought += qty;
         rewardsEarned = Math.floor(c.bought / Number(state.threshold)) - old;
         c.rewards += rewardsEarned;
     }
     c.history.push({ date: new Date().toLocaleString('fr-FR'), qty, qualifies, orderId, rewardsEarned });
     await saveCustomerAPI(c);
     return { qualifies, rewardsEarned, customer: c };
 }

 // WhatsApp Order Handler
 if ($('whatsappOrder')) {
     $('whatsappOrder').onclick = async() => {
         const { totalPrice, totalQty, lines } = getCartDetails();
         const name = $('studentName').value.trim();
         const phone = $('studentPhone').value.trim();
         const pickup = $('pickup').value;
         const details = $('details').value.trim();

         if (lines.length === 0) { alert('Ajoute au moins un article au panier.'); return; }
         if (!name) { alert('Entre ton nom ou ton surnom.'); return; }

         const wa = normalizePhone(state.whatsapp || ($('sellerWhatsapp') ? $('sellerWhatsapp').value : ''));
         if (!wa) {
             alert('Le vendeur doit d’abord configurer son numéro WhatsApp.');
             setTab('seller');
             return;
         }

         const summary = lines.map(l => `• ${l.name} x${l.qty} (${l.lineTotal} FCFA)`).join('%0A');

         const newOrder = {
             id: uid(),
             name,
             phone,
             qty: totalQty,
             total: totalPrice,
             pickup,
             notes: details + ' | Articles: ' + lines.map(l => `${l.name} x${l.qty}`).join(', '),
             status: 'En attente',
             date: new Date().toLocaleString('fr-FR'),
             source: 'étudiant',
             loyaltyCounted: false,
             loyaltyMessage: ''
         };
         await saveOrderAPI(newOrder);

         const msg = `Bonjour Choco Campus ! Je souhaite commander :%0A%0A👤 Nom : ${encodeURIComponent(name)}%0A🛒 Commande :%0A${summary}%0A%0A💰 Total : ${totalPrice} FCFA%0A📍 Retrait souhaité : ${encodeURIComponent(pickup)}%0A📞 Mon numéro : ${encodeURIComponent(phone || 'Non indiqué')}%0A📝 Précisions : ${encodeURIComponent(details || 'Aucune')}%0A%0AMerci de confirmer la disponibilité et l’heure de retrait.`;

         const url = `https://wa.me/${wa}?text=${msg}`;
         $('orderFeedback').innerHTML = '<div class="success">Commande enregistrée ! WhatsApp va s’ouvrir. Appuie sur <strong>Envoyer</strong> dans WhatsApp !</div>';
         window.open(url, '_blank');
     };
 }

 if ($('saveSettings')) $('saveSettings').onclick = saveSettingsAPI;

 if ($('saveManualOrder')) {
     $('saveManualOrder').onclick = async() => {
         const name = $('manualName').value.trim();
         const phone = $('manualPhone').value.trim();
         const qty = Number($('manualQty').value);
         if (!name) { alert('Entre le nom du client.'); return; }
         if (!Number.isInteger(qty) || qty < 1) { alert('Nombre de gaufres invalide.'); return; }

         // Corrected calculation (assuming manual entry is for standard 200 FCFA chocolate waffles unless specified)
         const total = qty * 200;

         const newOrder = {
             id: uid(),
             name,
             phone,
             qty,
             total,
             pickup: $('manualPickup').value,
             notes: $('manualNotes').value.trim(),
             status: 'En attente',
             date: new Date().toLocaleString('fr-FR'),
             source: 'vendeur',
             loyaltyCounted: false,
             loyaltyMessage: ''
         };
         await saveOrderAPI(newOrder);
         $('manualName').value = '';
         $('manualPhone').value = '';
         $('manualQty').value = '4';
         $('manualNotes').value = '';
         alert('Commande enregistrée dans la base de données.');
     };
 }

 window.setStatus = async(id, status) => {
     const o = state.orders.find(x => x.id === id);
     if (!o) return;
     o.status = status;
     if (status === 'Livrée' && !o.loyaltyCounted) {
         const r = await countLoyalty(o.name, o.phone, o.qty, o.id);
         o.loyaltyCounted = true;
         o.loyaltyMessage = r.qualifies ? `${o.qty} gaufre(s) ajoutée(s) au compteur de fidélité.` : `Non comptabilisée : achat inférieur au minimum.`;
         if (r.rewardsEarned) alert(`🎉 ${o.name} gagne ${r.rewardsEarned} gaufre(s) offerte(s) !`);
         else alert(o.loyaltyMessage);
     }
     await saveOrderAPI(o);
 };

 window.redeemReward = async(id) => {
     const c = state.customers.find(x => x.id === id);
     if (!c || c.rewards < 1) return;
     if (confirm(`Confirmer qu’une gaufre gratuite est remise à ${c.name} ?`)) {
         c.rewards--;
         c.history.push({ date: new Date().toLocaleString('fr-FR'), qty: 0, qualifies: false, note: 'Récompense remise' });
         await saveCustomerAPI(c);
     }
 };

 window.deleteOrder = async(id) => {
     if (confirm('Supprimer cette commande de la base de données ?')) {
         await deleteOrderAPI(id);
     }
 };

 function renderSeller() {
     if (!isAdminLoggedIn) return;
     $('statOrders').textContent = state.orders.length;
     $('statPending').textContent = state.orders.filter(o => o.status === 'En attente').length;
     $('statCustomers').textContent = state.customers.length;

     const cq = ($('customerSearch')?.value || '').toLowerCase();
     const cs = state.customers.filter(c => (c.name + ' ' + c.phone).toLowerCase().includes(cq));
     $('customersList').innerHTML = cs.length ? cs.map(c => {
                 const progress = c.bought % Number(state.threshold),
                     need = Number(state.threshold) - progress;
                 return `<article class="customer"><div class="order-head"><div><h3>${esc(c.name)}</h3><div class="muted">${esc(c.phone || 'Pas de téléphone')} · ${c.bought} gaufre(s) comptée(s)</div></div>${c.rewards ? `<span class="badge">${c.rewards} récompense(s) disponible(s)</span>` : ''}</div><div class="pips">${Array.from({ length: Number(state.threshold) }, (_, i) => `<span class="pip ${i < progress ? 'filled' : ''}">${i < progress ? '✓' : ''}</span>`).join('')}</div><div class="progress"><div style="width:${progress / Number(state.threshold) * 100}%"></div></div><p class="muted">${progress === 0 ? 'Cycle de fidélité au début.' : need + ' gaufre(s) comptée(s) avant la prochaine récompense.'}</p><div class="actions"><button ${c.rewards < 1 ? 'disabled' : ''} onclick="redeemReward('${c.id}')">🎁 Remettre une gaufre</button><button class="secondary" onclick="showCustomerHistory('${c.id}')">Historique</button></div><div id="ch-${c.id}" class="muted" hidden>${esc(c.history.map(h => `${h.date} :${h.qty ? '+' + h.qty + ' gaufre(s)' : 'récompense remise'}`).join('\n'))}</div></article>`;
    }).join('') : '<div class="empty">Aucun client fidélité pour le moment.</div>';
}

window.showCustomerHistory = id => { const e = $('ch-' + id); if (e) e.hidden = !e.hidden; };
if ($('orderSearch'))$('orderSearch').addEventListener('input', renderSeller);
if ($('customerSearch'))$('customerSearch').addEventListener('input', renderSeller);

loadData();