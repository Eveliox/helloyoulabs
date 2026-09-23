(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const escapeHTML = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const money = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  const arrow =
    '<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';
  const whatsapp = (message) =>
    `https://wa.me/17867803626?text=${encodeURIComponent(message)}`;
  const CART_KEY = "hyl_cart_v2";
  const variants = new Map();
  const selections = new Map();
  const productMap = new Map(PRODUCTS.map((product) => [product.id, product]));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  PRODUCTS.forEach((product) => {
    product.variants.forEach((variant) => {
      const key = String(variant.mgLabel || variant.mg)
        .replace(/\s/g, "")
        .replace(/\+/g, "x");
      variant.id = `${product.id}-${key}-${variant.ml}ml`;
      variant.productId = product.id;
      variant.label ||= `${variant.mg} mg · ${variant.ml} mL`;
      variants.set(variant.id, variant);
    });
    selections.set(product.id, product.variants[0].id);
  });

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY));
      if (!Array.isArray(parsed?.items)) return [];
      const items = new Map();
      parsed.items.forEach((item) => {
        if (
          !item ||
          !variants.has(item.variantId) ||
          !Number.isSafeInteger(item.qty) ||
          item.qty < 1
        )
          return;
        items.set(
          item.variantId,
          Math.min(99, (items.get(item.variantId) || 0) + item.qty),
        );
      });
      return [...items].map(([variantId, qty]) => ({ variantId, qty }));
    } catch {
      return [];
    }
  }
  let cart = loadCart();
  let filter = "All";
  let toastTimer;
  const grid = $("#productGrid");
  const cartDialog = $("#cartDialog");
  const productDialog = $("#productDialog");

  function persist() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ items: cart }));
    } catch {
      /* Cart remains usable when browser storage is blocked. */
    }
  }
  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 3000);
  }
  function selectedVariant(product) {
    return variants.get(selections.get(product.id));
  }
  function optionHTML(product) {
    return product.variants
      .map(
        (variant) =>
          `<option value="${escapeHTML(variant.id)}"${selections.get(product.id) === variant.id ? " selected" : ""}>${escapeHTML(variant.label)} · ${money(variant.price)}</option>`,
      )
      .join("");
  }
  function renderProducts() {
    const products = PRODUCTS.filter(
      (product) =>
        filter === "All" ||
        (filter === "Single"
          ? ["Repair", "GHS"].includes(product.catFilter)
          : product.catFilter === filter),
    );
    grid.innerHTML = products
      .map((product) => {
        const variant = selectedVariant(product);
        return `<article class="product-card" data-product="${product.id}">
        <button class="product-image" data-details="${product.id}" aria-label="View ${escapeHTML(product.name)} details"><img src="${product.img}" alt="Hello You Labs ${escapeHTML(product.name)} research vial" width="650" height="650" loading="lazy"><span class="product-tag">RESEARCH ONLY</span><span class="product-mark" aria-hidden="true">Hy.</span></button>
        <div class="product-info"><div class="product-title-row"><h3>${escapeHTML(product.name)}</h3><div class="price"><span data-card-price>${money(variant.price)}</span><small>per vial</small></div></div>
        <select class="variant-select" data-product-select="${product.id}" aria-label="Select vial option for ${escapeHTML(product.name)}">${optionHTML(product)}</select>
        <div class="product-actions"><button class="add-button" data-add="${product.id}" aria-label="Add ${escapeHTML(product.name)} to cart">+</button><button class="details-button" data-details="${product.id}">Details ${arrow}</button></div></div>
      </article>`;
      })
      .join("");
    $("#catalogCount").textContent =
      `${products.length} compound${products.length === 1 ? "" : "s"}`;
    grid.scrollLeft = 0;
    requestAnimationFrame(updateCarousel);
  }
  function updateCarousel() {
    $("#productsPrev").disabled = grid.scrollLeft < 5;
    $("#productsNext").disabled =
      grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 5;
  }
  function scrollProducts(direction) {
    const card = $(".product-card", grid);
    if (!card) return;
    const gap = parseFloat(getComputedStyle(grid).gap) || 19;
    const step = card.getBoundingClientRect().width + gap;
    grid.scrollBy({
      left: direction * step * Math.max(1, Math.floor(grid.clientWidth / step)),
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });
  }
  $("#productsPrev").addEventListener("click", () => scrollProducts(-1));
  $("#productsNext").addEventListener("click", () => scrollProducts(1));
  grid.addEventListener("scroll", updateCarousel, { passive: true });
  window.addEventListener("resize", updateCarousel);
  $$(".filter").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      $$(".filter").forEach((pill) => {
        const active = pill === button;
        pill.classList.toggle("active", active);
        pill.setAttribute("aria-pressed", String(active));
      });
      renderProducts();
    }),
  );

  function showDetails(id) {
    const product = productMap.get(id);
    if (!product) return;
    const variant = selectedVariant(product);
    $("#productDetails").innerHTML = `<div class="product-detail-grid">
      <div class="detail-image"><img src="${product.img}" width="650" height="650" alt="Hello You Labs ${escapeHTML(product.name)} research vial"></div>
      <div class="detail-content"><p class="eyebrow">The research collection · Laboratory use only</p><h2 id="productDialogTitle">${escapeHTML(product.name)}</h2><p class="detail-molecule">${escapeHTML(product.molecule)}</p>
      <div class="detail-spec"><span>Format</span><strong>Lyophilized research material</strong></div>
      <label for="detailVariant">Select your vial option</label><select id="detailVariant" data-product-select="${id}">${optionHTML(product)}</select>
      <p class="detail-price"><strong id="detailPrice">${money(variant.price)}</strong> <span>per vial · USD</span></p>
      <button class="button" data-add="${id}" data-from-details>Add to cart ${arrow}</button>
      <a class="text-link" target="_blank" rel="noopener" href="${whatsapp(`Hi Hello You Labs, I'd like to request the current lot's certificate of analysis for ${product.name}.`)}">Request COA ${arrow}</a>
      <p class="detail-disclaimer">For in-vitro laboratory research only. Not for human or veterinary use. Product imagery is illustrative and may not reflect your selected vial option. Confirm current availability and lot documentation with our team.</p></div></div>`;
    productDialog.showModal();
  }
  function updateSelection(select) {
    const product = productMap.get(select.dataset.productSelect);
    const variant = variants.get(select.value);
    if (!product || !variant || variant.productId !== product.id) return;
    selections.set(product.id, variant.id);
    $$(`[data-product-select="${product.id}"]`).forEach((element) => {
      element.value = variant.id;
    });
    const card = $(`[data-product="${product.id}"]`);
    if (card) $("[data-card-price]", card).textContent = money(variant.price);
    if (productDialog.open)
      $("#detailPrice").textContent = money(variant.price);
  }

  function total() {
    return cart.reduce(
      (sum, item) => sum + variants.get(item.variantId).price * item.qty,
      0,
    );
  }
  function updateCheckout() {
    $("#cartCheckout").disabled =
      !cart.length || !$("#researchConfirm").checked;
  }
  function renderCart() {
    const active = document.activeElement;
    const focusAction = active?.dataset.cartAction;
    const focusVariant = active?.dataset.variant;
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    $("#cartCount").textContent = count;
    $("[data-cart-open]").setAttribute(
      "aria-label",
      `Open cart, ${count} item${count === 1 ? "" : "s"}`,
    );
    $("#cartTitleCount").textContent = count ? `(${count})` : "";
    $("#cartSubtotal").textContent = money(total()) + ".00";
    $("#cartItems").innerHTML = cart.length
      ? cart
          .map((item) => {
            const variant = variants.get(item.variantId);
            const product = productMap.get(variant.productId);
            return `<div class="cart-item"><img src="${product.img}" width="67" height="80" alt="${escapeHTML(product.name)} vial"><div><h3>${escapeHTML(product.name)}</h3><p class="cart-item-spec">${escapeHTML(variant.label)}</p><div class="cart-item-controls"><div class="quantity-control" role="group" aria-label="Quantity for ${escapeHTML(product.name)}"><button data-cart-action="minus" data-variant="${escapeHTML(variant.id)}" aria-label="Decrease ${escapeHTML(product.name)} quantity">−</button><span>${item.qty}</span><button data-cart-action="plus" data-variant="${escapeHTML(variant.id)}" aria-label="Increase ${escapeHTML(product.name)} quantity"${item.qty >= 99 ? " disabled" : ""}>+</button></div><button class="remove-item" data-cart-action="remove" data-variant="${escapeHTML(variant.id)}" aria-label="Remove ${escapeHTML(product.name)}">Remove</button></div></div><span class="cart-item-price">${money(variant.price * item.qty)}</span></div>`;
          })
          .join("")
      : '<div class="cart-empty"><svg class="icon" aria-hidden="true"><use href="#i-bag"/></svg><h3>A little room for discovery.</h3><p>Your cart is empty. Explore the collection to find your research materials.</p><button class="button" data-browse>Explore the catalog →</button></div>';
    if (!cart.length) $("#researchConfirm").checked = false;
    updateCheckout();
    if (focusAction && cartDialog.open) {
      const replacement = $$("[data-cart-action]", cartDialog).find(
        (button) =>
          button.dataset.cartAction === focusAction &&
          button.dataset.variant === focusVariant,
      );
      (
        replacement ||
        $("[data-cart-action]", cartDialog) ||
        $("[data-browse]", cartDialog)
      ).focus({ preventScroll: true });
    }
  }
  function addProduct(id) {
    const product = productMap.get(id);
    if (!product) return false;
    const variant = selectedVariant(product);
    const item = cart.find((item) => item.variantId === variant.id);
    if (item?.qty >= 99) {
      toast("Maximum 99 vials per option. Contact us for bulk orders.");
      return false;
    }
    if (item) item.qty += 1;
    else cart.push({ variantId: variant.id, qty: 1 });
    persist();
    renderCart();
    toast(`${product.name} added to your cart.`);
    return true;
  }
  function openCart() {
    if (productDialog.open) productDialog.close();
    closeMenu();
    cartDialog.showModal();
  }
  $("#researchConfirm").addEventListener("change", updateCheckout);
  $("#cartCheckout").addEventListener("click", () => {
    if (!cart.length || !$("#researchConfirm").checked) return;
    const lines = cart.map((item) => {
      const variant = variants.get(item.variantId);
      const product = productMap.get(variant.productId);
      return `• ${product.name} — ${variant.label} × ${item.qty} — ${money(variant.price * item.qty)}`;
    });
    const message = `Hi Hello You Labs, I'd like to inquire about this research order:\n\n${lines.join("\n")}\n\nSubtotal: ${money(total())} USD (before shipping)\n\nI confirm that I am at least 21, a qualified researcher, and these materials are for laboratory research only. Please confirm availability, current lot documentation, shipping, and payment options. Thank you!`;
    window.open(whatsapp(message), "_blank", "noopener,noreferrer");
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-cart-open")) openCart();
    else if (button.hasAttribute("data-close-dialog"))
      button.closest("dialog").close();
    else if (button.hasAttribute("data-details"))
      showDetails(button.dataset.details);
    else if (button.hasAttribute("data-add")) {
      const added = addProduct(button.dataset.add);
      if (added && button.hasAttribute("data-from-details")) openCart();
    } else if (button.hasAttribute("data-browse")) {
      cartDialog.close();
      $("#catalog").scrollIntoView({
        behavior: reducedMotion.matches ? "instant" : "smooth",
      });
      $(".filter").focus({ preventScroll: true });
    } else if (button.hasAttribute("data-cart-action")) {
      const item = cart.find(
        (item) => item.variantId === button.dataset.variant,
      );
      if (!item) return;
      const action = button.dataset.cartAction;
      if (action === "plus") item.qty = Math.min(99, item.qty + 1);
      else if (action === "minus") item.qty -= 1;
      if (action === "remove" || item.qty < 1)
        cart = cart.filter((entry) => entry !== item);
      persist();
      renderCart();
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-product-select]"))
      updateSelection(event.target);
  });
  [cartDialog, productDialog].forEach((dialog) => {
    // Click outside the dialog's rectangle closes it; clicking padding does not.
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    });
  });

  // Mobile navigation stays within normal document flow and supports Escape.
  const menuToggle = $("#menuToggle");
  const mobileNav = $("#mobileNav");
  function closeMenu() {
    mobileNav.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open menu");
  }
  menuToggle.addEventListener("click", () => {
    const open = mobileNav.hidden;
    mobileNav.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  mobileNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mobileNav.hidden) {
      closeMenu();
      menuToggle.focus();
    }
  });
  window
    .matchMedia("(min-width: 901px)")
    .addEventListener("change", (event) => {
      if (event.matches) closeMenu();
    });

  // Accessible tabs: arrows, Home and End move and activate the focused tab.
  const tabs = $$("[data-approach]");
  function selectTab(tab) {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(`#${item.getAttribute("aria-controls")}`).hidden = !selected;
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft")
        next = tabs[(index + tabs.length - 1) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        selectTab(next);
        next.focus();
      }
    });
  });

  // The existing brand film plays only on request, including for reduced-motion users.
  const video = $("#brandVideo");
  const filmToggle = $("#filmToggle");
  filmToggle.addEventListener("click", async () => {
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      await video.play();
    } catch {
      toast("The film could not be loaded. Please try again.");
    }
  });
  const updateFilmButton = () => {
    filmToggle.innerHTML = video.paused
      ? "Play film <span>▷</span>"
      : "Pause film <span>Ⅱ</span>";
    filmToggle.setAttribute(
      "aria-label",
      video.paused ? "Play product film" : "Pause product film",
    );
  };
  video.addEventListener("play", updateFilmButton);
  video.addEventListener("pause", updateFilmButton);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) video.pause();
      },
      { threshold: 0.05 },
    ).observe(video);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) video.pause();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === CART_KEY || event.key === null) {
      cart = loadCart();
      renderCart();
    }
  });
  $("#year").textContent = new Date().getFullYear();
  renderProducts();
  renderCart();
})();
