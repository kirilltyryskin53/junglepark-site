document.addEventListener('DOMContentLoaded', () => {
  const locale = document.documentElement?.lang === 'kk' ? 'kk-KZ' : 'ru-RU';
  const orderModal = document.getElementById('orderModal');
  const orderForm = document.getElementById('orderForm');
  const orderButton = document.getElementById('openOrder');
  const orderList = document.getElementById('orderList');
  const orderTotal = document.getElementById('orderTotal');
  const orderSuccess = document.getElementById('orderSuccess');
  const orderError = document.getElementById('orderError');

  const bookingModal = document.getElementById('bookingModal');
  const bookingForm = document.getElementById('bookingForm');
  const bookingProgram = document.getElementById('bookingProgram');
  const bookingSuccess = document.getElementById('bookingSuccess');
  const bookingError = document.getElementById('bookingError');
  const programNameDisplay = document.getElementById('programNameDisplay');

  function getCheckedMenuItems() {
    const items = [];
    document.querySelectorAll('input[data-menu-item]').forEach((input) => {
      if (input.checked) {
        items.push({
          id: input.value,
          title: input.dataset.title,
          price: Number(input.dataset.price)
        });
      }
    });
    return items;
  }

  function updateTotal() {
    const items = getCheckedMenuItems();
    const total = items.reduce((sum, item) => sum + item.price, 0);
    if (orderList) {
      orderList.innerHTML = items
        .map((item) => `<li>${item.title} — ${item.price.toLocaleString(locale)} ₸</li>`)
        .join('');
    }
    if (orderTotal) {
      orderTotal.textContent =
        items.length === 0
          ? orderTotal.dataset.empty
          : total.toLocaleString(locale) + ' ₸';
    }
    if (orderButton) {
      orderButton.disabled = items.length === 0;
    }
  }

  document.querySelectorAll('input[data-menu-item]').forEach((input) => {
    input.addEventListener('change', updateTotal);
  });

  if (orderButton) {
    orderButton.addEventListener('click', () => {
      orderModal?.classList.add('active');
    });
  }

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.closeModal);
      target?.classList.remove('active');
      if (target === orderModal) {
        orderForm?.reset();
        orderSuccess?.classList.add('hidden');
        orderError?.classList.add('hidden');
      }
      if (target === bookingModal) {
        bookingForm?.reset();
        bookingSuccess?.classList.add('hidden');
        bookingError?.classList.add('hidden');
        if (programNameDisplay) {
          programNameDisplay.textContent = '';
        }
      }
    });
  });

  orderForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const items = getCheckedMenuItems();
    if (!items.length) {
      orderError?.classList.remove('hidden');
      orderError.textContent = orderForm.dataset.empty;
      return;
    }
    const formData = new FormData(orderForm);
    const payload = {
      items: items.map((item) => item.title),
      total: orderTotal?.textContent,
      address: formData.get('address'),
      phone: formData.get('phone')
    };
    try {
      const response = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error');
      }
      orderSuccess?.classList.remove('hidden');
      orderSuccess.textContent = data.message;
      orderError?.classList.add('hidden');
      orderForm.reset();
      document.querySelectorAll('input[data-menu-item]').forEach((input) => {
        input.checked = false;
      });
      updateTotal();
      setTimeout(() => {
        orderModal?.classList.remove('active');
      }, 1500);
    } catch (error) {
      orderError?.classList.remove('hidden');
      orderError.textContent = error.message;
    }
  });

  document.querySelectorAll('[data-program-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const programId = button.dataset.programId;
      const programTitle = button.dataset.programTitle;
      if (bookingProgram) {
        bookingProgram.value = programId;
        bookingProgram.dataset.title = programTitle;
      }
      if (programNameDisplay) {
        programNameDisplay.textContent = programTitle;
      }
      bookingModal?.classList.add('active');
    });
  });

  bookingForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(bookingForm);
    const payload = {
      programId: formData.get('programId'),
      childName: formData.get('childName'),
      date: formData.get('date'),
      phone: formData.get('phone'),
      name: formData.get('name')
    };
    try {
      const response = await fetch('/api/program-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error');
      }
      bookingSuccess?.classList.remove('hidden');
      bookingSuccess.textContent = data.message;
      bookingError?.classList.add('hidden');
      bookingForm.reset();
      if (programNameDisplay) {
        programNameDisplay.textContent = '';
      }
      setTimeout(() => {
        bookingModal?.classList.remove('active');
      }, 1500);
    } catch (error) {
      bookingError?.classList.remove('hidden');
      bookingError.textContent = error.message;
    }
  });

  updateTotal();
});
