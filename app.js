// ==========================================
// DATA MANAGEMENT (Hybrid Cloud Sync)
// ==========================================
const STORAGE_KEYS = { PRODUCTS: 'pos_products', SALES: 'pos_sales', SETTINGS: 'pos_settings' };

// 🚨 PASTE YOUR GOOGLE SCRIPT URL HERE:
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz4vCtRZu3IY2H7A47sz_fmscOkrAAT79H1H9JT1bib9ixrf3sK30AzSzQOL0d50J8o/exec';

function initializeData() {
    if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify([]));
    if (!localStorage.getItem(STORAGE_KEYS.SALES)) localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify([]));
    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ billPrefix: 'INV-', nextNumber: 1 }));
}

function getProducts() { return JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS)); }
function saveProducts(products) { localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products)); }
function getSales() { return JSON.parse(localStorage.getItem(STORAGE_KEYS.SALES)); }
function saveSales(sales) { localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales)); }
function getSettings() { return JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)); }
function saveSettings(settings) { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings)); }

const formatMoney = (amount) => `₹${parseFloat(amount).toFixed(2)}`;

// --- Application State ---
let cart = [];
let currentSearchTerm = "";
let editingProductId = null;
let checkoutSubtotal = 0;

document.addEventListener('DOMContentLoaded', () => {
    initializeData();
    
    // 1. Instantly load local cache for blazing fast UI
    if (document.getElementById('add-product-form')) initProductsPage();
    else if (document.getElementById('total-revenue')) initReportsPage();
    else if (document.getElementById('product-grid')) initPOSPage(); 
    
    // 2. Silently sync with Google Sheets Cloud in the background
    syncCloudToLocal();
});

// --- CLOUD SYNC MECHANISM ---
// --- CLOUD SYNC MECHANISM ---
async function syncCloudToLocal() {
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL);
        const cloudData = await response.json();
        
        if (cloudData.products && cloudData.products.length > 0) saveProducts(cloudData.products);
        if (cloudData.settings) saveSettings(cloudData.settings);
        
        if (cloudData.sales && cloudData.sales.length > 0) {
            // FIX: Map the cloud variables back to the local variable names before saving to prevent "Invalid Date"
            const formattedSales = cloudData.sales.map(row => ({
                id: row.id,
                date: row.rawDate || row.date, // Map rawDate back to date
                items: row.cartItems || row.items || [], // Map cartItems back to items
                discount: row.discount || 0,
                payment: row.payment || 'Cash',
                total: row.total || 0
            }));
            saveSales(formattedSales);
        }
        
        // Refresh UI with latest cloud data
        if (document.getElementById('product-grid')) renderProductGrid();
        if (document.getElementById('product-tbody')) renderProductTable();
        if (document.getElementById('total-revenue')) {
            currentSalesData = getSales(); // Reload the now correctly formatted local data
            updateAllReportViews();
            document.getElementById('report-title').innerHTML = "Sales Dashboard <small style='color:green;font-size:0.6em;'>(Cloud Synced 🟢)</small>";
        }
    } catch (error) {
        console.error("Working Offline. Cloud Sync Failed:", error);
    }
}

function pushStateToCloud() {
    fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'syncFullState', products: getProducts(), settings: getSettings() })
    }).catch(e => console.error("Error pushing to cloud", e));
}

// --- IMAGE COMPRESSION (Prevents Sheets Crash) ---
function compressImage(file, callback) {
    if (!file) return callback('');
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 150; // Tiny thumbnail for fast speed
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            callback(canvas.toDataURL('image/jpeg', 0.6)); // 60% quality JPEG
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

// ==========================================
// 1. POS DASHBOARD & CHECKOUT (index.html)
// ==========================================
function initPOSPage() {
    const searchInput = document.getElementById('search-product');
    if(searchInput) searchInput.addEventListener('input', (e) => { currentSearchTerm = e.target.value.toLowerCase(); renderProductGrid(); });
    renderProductGrid(); renderCart();

    const checkoutBtn = document.getElementById('checkout-btn');
    if(checkoutBtn) checkoutBtn.addEventListener('click', openCheckoutModal);

    const discountInput = document.getElementById('modal-discount');
    const paymentMode = document.getElementById('modal-payment-mode');
    const splitCash = document.getElementById('split-cash');
    const splitFields = document.getElementById('split-payment-fields');
    
    if(discountInput) discountInput.addEventListener('input', updateModalTotals);
    if(splitCash) splitCash.addEventListener('input', updateModalTotals);
    if(paymentMode) {
        paymentMode.addEventListener('change', (e) => {
            splitFields.style.display = e.target.value === 'Split' ? 'block' : 'none';
            updateModalTotals();
        });
    }
    
    document.getElementById('generate-only-btn')?.addEventListener('click', () => finalizeSale(false));
    document.getElementById('generate-print-btn')?.addEventListener('click', () => finalizeSale(true));
}

function renderProductGrid() {
    const grid = document.getElementById('product-grid');
    if(!grid) return;
    grid.innerHTML = '';
    getProducts().filter(p => p.name.toLowerCase().includes(currentSearchTerm)).forEach(product => {
        const isTracking = product.trackStock !== false; 
        const isOutOfStock = isTracking && product.stock <= 0;
        let stockText = isTracking ? `${product.stock} ${product.unit}` : "∞ Unlimited";
        let stockClass = isOutOfStock ? 'stock-out' : (product.stock <= 5 && isTracking ? 'stock-low' : (!isTracking ? 'stock-low' : ''));

        const card = document.createElement('div');
        card.className = `product-card ${isOutOfStock ? 'disabled' : ''}`;
        card.style.opacity = isOutOfStock ? '0.6' : '1';
        card.innerHTML = `
            <div class="stock-badge ${stockClass}">${isOutOfStock ? 'Out of Stock' : stockText}</div>
            <img src="${product.image || 'https://via.placeholder.com/150'}" alt="${product.name}">
            <div class="product-info"><h3>${product.name}</h3><div class="product-price">${formatMoney(product.price)}</div></div>
        `;
        if (!isOutOfStock) card.addEventListener('click', () => addToCart(product));
        grid.appendChild(card);
    });
}

function addToCart(product) {
    const existing = cart.find(item => item.id === product.id);
    const isTracking = product.trackStock !== false;
    if (existing) {
        if (!isTracking || existing.qty < product.stock) existing.qty++;
        else alert('Cannot exceed available stock!');
    } else {
        if (!isTracking || product.stock > 0) cart.push({ ...product, qty: 1 });
    }
    renderCart();
}

function updateCartQty(id, change) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    const product = getProducts().find(p => p.id === id);
    const newQty = item.qty + change;
    if (newQty <= 0) cart = cart.filter(i => i.id !== id);
    else if (product.trackStock !== false && newQty > product.stock) alert('Cannot exceed available stock!');
    else item.qty = newQty;
    renderCart();
}

function renderCart() {
    const cartContainer = document.getElementById('cart-items');
    if(!cartContainer) return;
    cartContainer.innerHTML = '';
    let total = 0;
    cart.forEach(item => {
        const subtotal = item.qty * item.price; total += subtotal;
        const div = document.createElement('div'); div.className = 'cart-item';
        div.innerHTML = `
            <div class="cart-item-details"><h4>${item.name}</h4><small>${formatMoney(item.price)} x ${item.qty}</small></div>
            <div class="cart-item-controls"><button onclick="updateCartQty('${item.id}', -1)">-</button><span>${item.qty}</span><button onclick="updateCartQty('${item.id}', 1)">+</button><strong style="margin-left:10px">${formatMoney(subtotal)}</strong></div>
        `;
        cartContainer.appendChild(div);
    });
    checkoutSubtotal = total;
    document.getElementById('cart-total').textContent = formatMoney(total);
}

function openCheckoutModal() {
    if (cart.length === 0) return alert('Cart is empty!');
    document.getElementById('checkout-modal').style.display = 'flex';
    document.getElementById('modal-subtotal').textContent = formatMoney(checkoutSubtotal);
    document.getElementById('modal-discount').value = 0;
    document.getElementById('modal-payment-mode').value = 'Cash';
    document.getElementById('split-payment-fields').style.display = 'none';
    updateModalTotals();
}

function updateModalTotals() {
    const discount = parseFloat(document.getElementById('modal-discount').value) || 0;
    const payable = checkoutSubtotal - discount;
    document.getElementById('modal-payable').textContent = formatMoney(payable > 0 ? payable : 0);
    if(document.getElementById('modal-payment-mode').value === 'Split') {
        const cashRec = parseFloat(document.getElementById('split-cash').value) || 0;
        document.getElementById('split-upi').value = (payable - cashRec) > 0 ? (payable - cashRec) : 0;
    }
}

function finalizeSale(shouldPrint) {
    const discount = parseFloat(document.getElementById('modal-discount').value) || 0;
    const finalTotal = checkoutSubtotal - discount;
    const paymentMode = document.getElementById('modal-payment-mode').value;
    let paymentDetails = paymentMode;
    if(paymentMode === 'Split') paymentDetails = `Split (Cash: ₹${document.getElementById('split-cash').value}, UPI: ₹${document.getElementById('split-upi').value})`;

    // Deduct Stock Locally
    const products = getProducts();
    cart.forEach(cartItem => {
        const pIndex = products.findIndex(p => p.id === cartItem.id);
        if (pIndex > -1 && products[pIndex].trackStock !== false) products[pIndex].stock -= cartItem.qty;
    });
    saveProducts(products); 

    // Generate Custom Bill Number
    const appSettings = getSettings();
    const billId = `${appSettings.billPrefix}${String(appSettings.nextNumber).padStart(4, '0')}`;
    appSettings.nextNumber += 1;
    saveSettings(appSettings);
    pushStateToCloud(); // Save new settings & stock to cloud

    const billDate = new Date().toISOString();
    const cleanCartForHistory = cart.map(item => ({ id: item.id, name: item.name, category: products.find(p => p.id === item.id)?.category || 'Uncategorized', price: item.price, qty: item.qty, unit: item.unit }));
    
    // Save Sale Locally
    const sales = getSales();
    sales.push({ id: billId, date: billDate, items: cleanCartForHistory, total: finalTotal, discount: discount, payment: paymentMode });
    saveSales(sales);

    // Push Sale to Cloud
    const dateObj = new Date(billDate);
    fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
            action: 'saveSale', id: billId, date: dateObj.toLocaleDateString(), time: dateObj.toLocaleTimeString(),
            items: cart.map(i => `${i.name} (${i.qty})`).join(' | '), discount: discount, payment: paymentMode, total: finalTotal,
            rawJson: JSON.stringify({ date: billDate, items: cleanCartForHistory }), updatedProducts: products
        })
    }).catch(e => console.error("Error saving sale to cloud"));

    // Populate Print Template
    document.getElementById('receipt-date').textContent = `${String(dateObj.getMonth()+1).padStart(2,'0')}.${String(dateObj.getDate()).padStart(2,'0')}.${dateObj.getFullYear()}`;
    document.getElementById('receipt-id').textContent = billId;
    document.getElementById('receipt-payment-mode').textContent = paymentDetails;
    const printItems = document.getElementById('receipt-items'); printItems.innerHTML = '';
    cart.forEach((item, index) => {
        printItems.innerHTML += `<tr><td>${index + 1}</td><td style="padding-right: 5px;">${item.name}</td><td>${parseFloat(item.qty).toFixed(2)}<br><span style="font-size: 10px;">${item.unit || 'Nos'}</span></td><td>${parseFloat(item.price).toFixed(2)}</td><td style="text-align: right;">${(item.qty * item.price).toFixed(2)}</td></tr>`;
    });
    document.getElementById('receipt-subtotal').textContent = checkoutSubtotal.toFixed(2);
    document.getElementById('receipt-discount').textContent = discount.toFixed(2);
    document.getElementById('receipt-final').textContent = 'RS.' + finalTotal.toFixed(2);

    document.getElementById('checkout-modal').style.display = 'none';
    cart = []; renderCart(); renderProductGrid(); 
    
    if (shouldPrint) setTimeout(() => { window.print(); }, 500);
    else alert(`Bill Saved Successfully!\nInvoice No: ${billId}\nTotal: ${formatMoney(finalTotal)}`);
}

// ==========================================
// 2. INVENTORY MANAGEMENT (products.html)
// ==========================================
function initProductsPage() {
    const form = document.getElementById('add-product-form');
    if(form) form.addEventListener('submit', handleAddProduct);

    const settingsForm = document.getElementById('settings-form');
    if(settingsForm) {
        const settings = getSettings();
        document.getElementById('set-prefix').value = settings.billPrefix;
        document.getElementById('set-next-num').value = settings.nextNumber;
        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const prefix = document.getElementById('set-prefix').value;
            const nextNum = parseInt(document.getElementById('set-next-num').value);
            saveSettings({ billPrefix: prefix, nextNumber: nextNum });
            pushStateToCloud(); // Sync to cloud
            alert(`Settings updated!\nNext bill will be: ${prefix}${String(nextNum).padStart(4, '0')}`);
        });
    }
    renderProductTable();
}

function handleAddProduct(e) {
    e.preventDefault();
    const type = document.getElementById('p-type').value;
    const category = document.getElementById('p-category').value;
    const name = document.getElementById('p-name').value;
    const price = parseFloat(document.getElementById('p-price').value);
    const trackStock = document.getElementById('p-track-stock').checked;
    const stock = trackStock ? parseFloat(document.getElementById('p-stock').value) : 0;
    const unit = document.getElementById('p-unit').value;
    const imageInput = document.getElementById('p-image');
    
    if (!name || isNaN(price)) return alert('Please fill required fields properly');

    compressImage(imageInput && imageInput.files ? imageInput.files[0] : null, (compressedBase64) => {
        let products = getProducts();
        if (editingProductId) {
            const index = products.findIndex(p => p.id === editingProductId);
            if (index > -1) products[index] = { ...products[index], type, category, name, price, trackStock, stock, unit, image: compressedBase64 || products[index].image };
            editingProductId = null;
            document.getElementById('form-title').textContent = 'Add New Item';
            document.getElementById('submit-btn').textContent = 'Save Item';
        } else {
            products.push({ id: 'PROD-' + Date.now(), type, category, name, price, trackStock, stock, unit, image: compressedBase64 });
        }
        
        saveProducts(products); 
        pushStateToCloud(); // Push changes to master cloud database
        
        document.getElementById('add-product-form').reset();
        document.getElementById('p-track-stock').dispatchEvent(new Event('change')); 
        renderProductTable();
    });
}

function editProduct(id) {
    const product = getProducts().find(p => p.id === id);
    if (!product) return;
    document.getElementById('p-type').value = product.type || 'Product';
    document.getElementById('p-category').value = product.category || '';
    document.getElementById('p-name').value = product.name;
    document.getElementById('p-price').value = product.price;
    document.getElementById('p-unit').value = product.unit;
    const trackStockCheckbox = document.getElementById('p-track-stock');
    trackStockCheckbox.checked = product.trackStock !== false;
    trackStockCheckbox.dispatchEvent(new Event('change')); 
    if(product.trackStock !== false) document.getElementById('p-stock').value = product.stock;
    editingProductId = id;
    document.getElementById('form-title').textContent = `Editing: ${product.name}`;
    document.getElementById('submit-btn').textContent = 'Update Item';
    window.scrollTo(0, 0); 
}

function deleteProduct(id) {
    if(!confirm('Are you sure you want to delete this item?')) return;
    saveProducts(getProducts().filter(p => p.id !== id)); 
    pushStateToCloud(); // Push deletion to cloud
    renderProductTable();
}

function renderProductTable() {
    const tbody = document.getElementById('product-tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    getProducts().forEach(p => {
        const stockDisplay = (p.trackStock !== false) ? `${p.stock} ${p.unit}` : '<span style="color:#6b7280; font-weight:bold;">∞</span>';
        tbody.innerHTML += `<tr><td><div style="display:flex; align-items:center; gap:10px;"><img src="${p.image || 'https://via.placeholder.com/50'}" width="30" height="30" style="border-radius:4px; object-fit:cover;"><strong>${p.name}</strong></div></td><td>${p.category || '-'}</td><td><span style="font-size:0.8rem; background:#f3f4f6; padding:2px 6px; border-radius:4px;">${p.type || 'Product'}</span></td><td>${formatMoney(p.price)}</td><td>${stockDisplay}</td><td><button class="btn btn-primary btn-sm" onclick="editProduct('${p.id}')" style="margin-right:5px; padding: 0.3rem 0.6rem;">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')" style="padding: 0.3rem 0.6rem;">Del</button></td></tr>`;
    });
}

// ==========================================
// 3. REPORTS & ANALYTICS (Cloud Synced & Safe)
// ==========================================
let currentSalesData = [];
let lineChartInstance = null;
let pieChartInstance = null;

function initReportsPage() {
    document.getElementById('report-title').innerHTML = "Loading Data... ⏳";
    
    // Instantly load local data (Background sync will update it momentarily)
    currentSalesData = getSales();
    updateAllReportViews();

    const applyBtn = document.getElementById('apply-filter-btn');
    const resetBtn = document.getElementById('reset-filter-btn');
    
    // Replace nodes to prevent duplicate event listeners
    const newApply = applyBtn.cloneNode(true);
    applyBtn.parentNode.replaceChild(newApply, applyBtn);
    newApply.addEventListener('click', applyDateFilter);

    const newReset = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(newReset, resetBtn);
    newReset.addEventListener('click', () => {
        document.getElementById('filter-start').value = ''; 
        document.getElementById('filter-end').value = '';
        currentSalesData = getSales(); 
        updateAllReportViews();
    });

    const exportBtn = document.getElementById('export-sheet-btn');
    if(exportBtn) {
        const newExport = exportBtn.cloneNode(true);
        exportBtn.parentNode.replaceChild(newExport, exportBtn);
        newExport.addEventListener('click', exportToCSV);
    }

    // --- FIX: WIPE DATA BUTTON RESTORED ---
    const clearBtn = document.getElementById('clear-sales-btn');
    if(clearBtn) {
        const newClear = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClear, clearBtn);
        newClear.addEventListener('click', () => {
            if(confirm('WARNING: This will wipe your local sales memory to fix errors. (Your Google Sheets data is safe). Proceed?')) {
                saveSales([]); // Wipes the corrupted local memory
                location.reload(); // Reloads the page to pull fresh from the cloud
            }
        });
    }
}
function applyDateFilter() {
    const start = document.getElementById('filter-start').value;
    const end = document.getElementById('filter-end').value;
    let allSales = [...currentSalesData];
    if (start) { const sd = new Date(start); sd.setHours(0,0,0,0); allSales = allSales.filter(b => new Date(b.date) >= sd); }
    if (end) { const ed = new Date(end); ed.setHours(23,59,59,999); allSales = allSales.filter(b => new Date(b.date) <= ed); }
    currentSalesData = allSales;
    updateAllReportViews();
}

function updateAllReportViews() {
    renderStats(); renderSalesTable(); renderSalesByItem(); renderSalesByCategory(); renderCharts();
}

function renderStats() {
    const totalRevenue = currentSalesData.reduce((sum, bill) => sum + bill.total, 0);
    const totalDiscounts = currentSalesData.reduce((sum, bill) => sum + (bill.discount || 0), 0);
    document.getElementById('total-revenue').textContent = formatMoney(totalRevenue);
    document.getElementById('total-discounts').textContent = formatMoney(totalDiscounts);
    document.getElementById('total-orders').textContent = currentSalesData.length;
}

function renderCharts() {
    const dailyRevenue = {};
    currentSalesData.forEach(b => {
        const dStr = new Date(b.date).toLocaleDateString();
        if (!dailyRevenue[dStr]) dailyRevenue[dStr] = 0;
        dailyRevenue[dStr] += b.total;
    });
    const dates = Object.keys(dailyRevenue).sort((a,b) => new Date(a) - new Date(b));
    const revenues = dates.map(d => dailyRevenue[d]);

    if (lineChartInstance) lineChartInstance.destroy();
    lineChartInstance = new Chart(document.getElementById('revenueLineChart').getContext('2d'), {
        type: 'line',
        data: { labels: dates.length ? dates : ['N/A'], datasets: [{ label: 'Daily Revenue', data: revenues.length ? revenues : [0], borderColor: '#16a34a', backgroundColor: 'rgba(22, 163, 74, 0.1)', fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const catRevenue = {};
    currentSalesData.forEach(b => {
        if (Array.isArray(b.items)) {
            b.items.forEach(i => {
                const cat = i.category || 'Other';
                if (!catRevenue[cat]) catRevenue[cat] = 0;
                catRevenue[cat] += (i.qty * i.price);
            });
        }
    });

    if (pieChartInstance) pieChartInstance.destroy();
    pieChartInstance = new Chart(document.getElementById('categoryPieChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: Object.keys(catRevenue).length ? Object.keys(catRevenue) : ['N/A'], datasets: [{ data: Object.values(catRevenue).length ? Object.values(catRevenue) : [1], backgroundColor: ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#8b5cf6'] }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderSalesByItem() {
    const tbody = document.getElementById('sales-by-item-tbody');
    if(!tbody) return;
    const stats = {};
    currentSalesData.forEach(b => {
        if (Array.isArray(b.items)) {
            b.items.forEach(i => {
                if(!stats[i.id]) stats[i.id] = { name: i.name, cat: i.category, qty: 0, rev: 0 };
                stats[i.id].qty += i.qty; stats[i.id].rev += (i.qty * i.price);
            });
        }
    });
    tbody.innerHTML = Object.values(stats).sort((a,b) => b.rev - a.rev).map(i => `<tr><td>${i.name}</td><td>${i.cat || '-'}</td><td>${i.qty}</td><td>${formatMoney(i.rev)}</td></tr>`).join('');
}

function renderSalesByCategory() {
    const tbody = document.getElementById('sales-by-category-tbody');
    if(!tbody) return;
    const stats = {};
    currentSalesData.forEach(b => {
        if (Array.isArray(b.items)) {
            b.items.forEach(i => {
                const cat = i.category || 'Other';
                if(!stats[cat]) stats[cat] = { qty: 0, rev: 0 };
                stats[cat].qty += i.qty; stats[cat].rev += (i.qty * i.price);
            });
        }
    });
    tbody.innerHTML = Object.entries(stats).sort((a,b) => b[1].rev - a[1].rev).map(([cat, s]) => `<tr><td><strong>${cat}</strong></td><td>${s.qty}</td><td>${formatMoney(s.rev)}</td></tr>`).join('');
}

function renderSalesTable() {
    const tbody = document.getElementById('sales-tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    [...currentSalesData].reverse().forEach(b => {
        const dStr = new Date(b.date).toLocaleString();
        let details = "";
        
        // SAFE FALLBACK: Check if items is an Array (New format) or String (Old format)
        if (Array.isArray(b.items)) {
            details = b.items.map(i => `${i.name} (${i.qty})`).join(', ');
        } else {
            details = b.items || "-"; // Just print the old string
        }

        if(b.discount > 0) details += `<br><small style="color:#d97706">Discount: -₹${b.discount}</small>`;
        if(b.payment) details += `<br><small style="color:#2563eb">Paid via: ${b.payment}</small>`;
        
        tbody.innerHTML += `<tr><td>${b.id}</td><td>${dStr}</td><td class="receipt-style">${details}</td><td style="font-weight:bold;">${formatMoney(b.total)}</td><td><button class="btn btn-success btn-sm" onclick="reprintBill('${b.id}')" style="padding: 0.4rem 0.8rem;">Print</button></td></tr>`;
    });
}

function exportToCSV() {
    if (currentSalesData.length === 0) return alert("No sales data available.");
    let csv = "data:text/csv;charset=utf-8,Bill ID,Date,Time,Items Sold,Discount,Payment Mode,Total Amount\n";
    currentSalesData.forEach(b => { 
        const d = new Date(b.date); 
        let itemStr = Array.isArray(b.items) ? b.items.map(i => `${i.name} (${i.qty})`).join(' | ') : b.items;
        csv += `"${b.id}","${d.toLocaleDateString()}","${d.toLocaleTimeString()}","${itemStr}","${b.discount || 0}","${b.payment || 'Cash'}","${b.total}"\n`; 
    });
    const link = document.createElement("a"); link.setAttribute("href", encodeURI(csv)); link.setAttribute("download", `Sales.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function reprintBill(billId) {
    const bill = currentSalesData.find(b => b.id === billId);
    if (!bill) return alert("Bill not found!");
    const d = new Date(bill.date);
    document.getElementById('receipt-date').textContent = `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}.${d.getFullYear()}`;
    document.getElementById('receipt-id').textContent = bill.id;
    document.getElementById('receipt-payment-mode').textContent = bill.payment || 'Cash';
    
    const printItems = document.getElementById('receipt-items'); printItems.innerHTML = ''; 
    let subtotal = 0;
    
    // SAFE FALLBACK FOR REPRINTING
    if (Array.isArray(bill.items)) {
        bill.items.forEach((item, index) => { 
            subtotal += (item.qty * item.price); 
            printItems.innerHTML += `<tr><td>${index + 1}</td><td style="padding-right: 5px;">${item.name}</td><td>${parseFloat(item.qty).toFixed(2)}<br><span style="font-size: 10px;">${item.unit || 'Nos'}</span></td><td>${parseFloat(item.price).toFixed(2)}</td><td style="text-align: right;">${(item.qty * item.price).toFixed(2)}</td></tr>`; 
        });
    } else {
        // If it's an old legacy bill, just print the text string
        printItems.innerHTML += `<tr><td>1</td><td colspan="4" style="padding-right: 5px;">${bill.items}</td></tr>`;
        subtotal = bill.total + (bill.discount || 0); // Reverse math for old bills
    }
    
    document.getElementById('receipt-subtotal').textContent = subtotal.toFixed(2);
    document.getElementById('receipt-discount').textContent = (bill.discount || 0).toFixed(2);
    document.getElementById('receipt-final').textContent = 'RS.' + bill.total.toFixed(2);
    setTimeout(() => { window.print(); }, 500);
}