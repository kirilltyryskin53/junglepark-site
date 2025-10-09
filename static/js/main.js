(function () {
  const formatCurrency = (value) => `${value} тг`;

  const body = document.body;
  const lang = body.dataset.lang || 'ru';

  const openModal = (modal) => {
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  const closeModal = (modal) => {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(btn.closest('.modal'));
    });
  });

  // Seasonal banners modal
  const seasonalModal = document.querySelector('.seasonal-modal');
  const seasonalForm = seasonalModal ? seasonalModal.querySelector('[data-seasonal-form]') : null;
  const seasonalStatus = seasonalModal ? seasonalModal.querySelector('.form-status') : null;
  if (seasonalModal && seasonalForm) {
    const bannerIdInput = seasonalForm.querySelector('#bannerId');
    const titleTarget = seasonalModal.querySelector('[data-modal-title]');

    let activeSeasonalBanner = '';
    document.querySelectorAll('[data-seasonal-trigger]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bannerId = btn.dataset.bannerId;
        const bannerTitle = btn.dataset.bannerTitle;
        activeSeasonalBanner = bannerId;
        if (seasonalStatus) {
          seasonalStatus.hidden = true;
          seasonalStatus.textContent = '';
        }
        seasonalForm.reset();
        if (bannerIdInput) bannerIdInput.value = bannerId;
        if (titleTarget) titleTarget.textContent = bannerTitle;
        openModal(seasonalModal);
      });
    });

    seasonalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!bannerIdInput.value) return;
      const payload = {
        parentName: seasonalForm.parentName.value.trim(),
        childName: seasonalForm.childName.value.trim(),
        age: seasonalForm.age.value.trim(),
        phone: seasonalForm.phone.value.trim(),
      };
      const submitBtn = seasonalForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const res = await fetch(`/api/banner-signup/${bannerIdInput.value}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'error');
        if (seasonalStatus) {
          seasonalStatus.hidden = false;
          seasonalStatus.textContent = lang === 'kk' ? 'Өтініш жіберілді! Біз хабарласамыз.' : 'Заявка отправлена! Мы свяжемся с вами.';
          seasonalStatus.className = 'form-status success';
        }
        seasonalForm.reset();
        if (bannerIdInput) bannerIdInput.value = activeSeasonalBanner;
      } catch (err) {
        if (seasonalStatus) {
          seasonalStatus.hidden = false;
          seasonalStatus.textContent = lang === 'kk' ? 'Қате пайда болды. Қайталап көріңіз.' : 'Произошла ошибка. Попробуйте снова.';
          seasonalStatus.className = 'form-status error';
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // Discount banners -> redirect to menu with preselected item
  document.querySelectorAll('[data-discount]').forEach((card) => {
    card.addEventListener('click', () => {
      const itemId = card.dataset.itemId;
      if (itemId) {
        window.location.href = `${window.location.origin}/menu?addItem=${encodeURIComponent(itemId)}`;
      }
    });
  });

  // Program modal
  const programModal = document.querySelector('.program-modal');
  const programForm = programModal ? programModal.querySelector('[data-program-form]') : null;
  const programStatus = programModal ? programModal.querySelector('.form-status') : null;
  if (programModal && programForm) {
    const programIdInput = programForm.querySelector('#programId');
    const titleTarget = programModal.querySelector('[data-modal-title]');
    let activeProgramId = '';
    document.querySelectorAll('[data-request-program]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('[data-program-id]');
        if (!card) return;
        const programId = card.dataset.programId;
        const programName = card.dataset.programName;
        activeProgramId = programId;
        if (programStatus) {
          programStatus.hidden = true;
          programStatus.textContent = '';
        }
        programForm.reset();
        programIdInput.value = programId;
        if (titleTarget) titleTarget.textContent = programName;
        openModal(programModal);
      });
    });

    programForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        programId: programIdInput.value,
        name: programForm.name.value.trim(),
        childName: programForm.childName.value.trim(),
        phone: programForm.phone.value.trim(),
        date: programForm.date.value,
      };
      const submitBtn = programForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/program-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'error');
        if (programStatus) {
          programStatus.hidden = false;
          programStatus.textContent = lang === 'kk' ? 'Өтініш жіберілді!' : 'Заявка отправлена!';
          programStatus.className = 'form-status success';
        }
        programForm.reset();
        programIdInput.value = activeProgramId;
      } catch (err) {
        if (programStatus) {
          programStatus.hidden = false;
          programStatus.textContent = lang === 'kk' ? 'Қате пайда болды. Қайталап көріңіз.' : 'Произошла ошибка. Попробуйте снова.';
          programStatus.className = 'form-status error';
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  const menuPage = document.querySelector('[data-menu-page]');
  if (menuPage) {
    const cartItemsContainer = menuPage.querySelector('[data-cart-items]');
    const subtotalEl = menuPage.querySelector('[data-cart-subtotal]');
    const deliveryEl = menuPage.querySelector('[data-cart-delivery]');
    const totalEl = menuPage.querySelector('[data-cart-total]');
    const openOrderBtn = menuPage.querySelector('[data-open-order]');
    const orderModal = document.querySelector('.order-modal');
    const orderForm = orderModal ? orderModal.querySelector('[data-order-form]') : null;
    const orderStatus = orderModal ? orderModal.querySelector('.form-status') : null;
    const cart = [];

    const findItem = (id) => cart.find((entry) => entry.id === id);

    const renderCart = () => {
      cartItemsContainer.innerHTML = '';
      let subtotal = 0;
      cart.forEach((entry) => {
        const li = document.createElement('li');
        li.className = 'cart-item';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${entry.name}`;
        const quantitySpan = document.createElement('span');
        quantitySpan.className = 'quantity';
        quantitySpan.textContent = `×${entry.quantity}`;
        const actions = document.createElement('div');
        actions.className = 'cart-actions';
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.textContent = '+';
        plus.addEventListener('click', () => {
          entry.quantity += 1;
          renderCart();
        });
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.textContent = '−';
        minus.addEventListener('click', () => {
          entry.quantity -= 1;
          if (entry.quantity <= 0) {
            const index = cart.indexOf(entry);
            cart.splice(index, 1);
          }
          renderCart();
        });
        actions.append(minus, plus);
        li.append(nameSpan, quantitySpan, actions);
        cartItemsContainer.appendChild(li);
        subtotal += entry.price * entry.quantity;
      });
      const delivery = subtotal > 0 && subtotal < 5000 ? 500 : 0;
      const total = subtotal + delivery;
      subtotalEl.textContent = formatCurrency(subtotal);
      deliveryEl.textContent = formatCurrency(delivery);
      totalEl.textContent = formatCurrency(total);
      openOrderBtn.disabled = cart.length === 0;
      openOrderBtn.dataset.total = total;
    };

    const addToCart = (item) => {
      const existing = findItem(item.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        cart.push({ ...item, quantity: 1 });
      }
      renderCart();
    };

    menuPage.querySelectorAll('[data-add-to-cart]').forEach((button) => {
      button.addEventListener('click', () => {
        const card = button.closest('[data-menu-item]');
        if (!card) return;
        addToCart({
          id: card.dataset.itemId,
          name: card.dataset.itemName,
          price: Number(card.dataset.itemPrice),
        });
      });
    });

    const autoAdd = menuPage.dataset.addItem;
    if (autoAdd) {
      const target = menuPage.querySelector(`[data-menu-item][data-item-id="${autoAdd}"]`);
      if (target) {
        addToCart({
          id: target.dataset.itemId,
          name: target.dataset.itemName,
          price: Number(target.dataset.itemPrice),
        });
        const highlight = document.createElement('div');
        highlight.className = 'flash flash-success';
        highlight.textContent = lang === 'kk' ? 'Жеңілдік қолданылды! Тапсырыс себетке қосылды.' : 'Скидка применена! Позиция добавлена в корзину.';
        menuPage.prepend(highlight);
        setTimeout(() => highlight.remove(), 4000);
      }
    }

    if (openOrderBtn && orderModal && orderForm) {
      openOrderBtn.addEventListener('click', () => {
        if (orderStatus) {
          orderStatus.hidden = true;
          orderStatus.textContent = '';
        }
        orderForm.reset();
        openModal(orderModal);
      });

      orderForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
          address: orderForm.address.value.trim(),
          phone: orderForm.phone.value.trim(),
          total: Number(openOrderBtn.dataset.total || 0),
          items: cart.map((entry) => `${entry.name} ×${entry.quantity}`),
        };
        const submitBtn = orderForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        try {
          const res = await fetch('/api/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'error');
          cart.splice(0, cart.length);
          renderCart();
          if (orderStatus) {
            orderStatus.hidden = false;
            orderStatus.textContent = lang === 'kk' ? 'Тапсырыс жіберілді! Біз хабарласамыз.' : 'Заказ отправлен! Мы свяжемся с вами.';
            orderStatus.className = 'form-status success';
          }
        } catch (err) {
          if (orderStatus) {
            orderStatus.hidden = false;
            orderStatus.textContent = lang === 'kk' ? 'Қате пайда болды. Қайталап көріңіз.' : 'Произошла ошибка. Попробуйте снова.';
            orderStatus.className = 'form-status error';
          }
        } finally {
          submitBtn.disabled = false;
        }
      });
    }
  }

  // Close modal when clicking backdrop
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });
})();
