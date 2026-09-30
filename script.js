
// ============================================================
// Supabase Connection
// ============================================================

const SUPABASE_URL = "https://xuctfoiwzflevnfwfqcv.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rTGBl1I4QLj51DIIu5ygDQ_LmS9jK8C";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

/**
 * Uploads a prescription file to the "prescriptions" Storage bucket
 * and returns its private object path, or null if no file / upload failed.
 * `seq` keeps generated filenames unique when several files upload at once.
 */
async function uploadPrescriptionFile(file, seq = 0) {
    if (!file) return null;

    try {
        const fileExt = file.name.split(".").pop();
        const safeName = `${Date.now()}_${seq}_${Math.floor(Math.random() * 100000)}.${fileExt}`;

        const { error: uploadError } = await supabaseClient
            .storage
            .from("prescriptions")
            .upload(safeName, file, {
                cacheControl: "3600",
                upsert: false
            });

        if (uploadError) {
            console.error("Prescription upload error:", uploadError);
            return null;
        }

        // The prescriptions bucket is private. Store its object path so staff
        // can request a short-lived signed URL instead of persisting a public URL.
        return safeName;

    } catch (err) {
        console.error("Unexpected prescription upload error:", err);
        return null;
    }
}

const MAX_RX_FILES = 5;

/**
 * Uploads several prescription files in parallel.
 * @returns {Promise<{urls: string[], failedNames: string[]}>}
 *          urls keeps upload order for storage in prescription_url.
 */
async function uploadPrescriptionFiles(files) {
    const list = Array.from(files || []);
    const results = await Promise.all(list.map((f, i) => uploadPrescriptionFile(f, i)));

    return {
        urls: results.filter(Boolean),
        failedNames: list.filter((f, i) => !results[i]).map((f) => f.name)
    };
}

/** Stores every uploaded path in prescription_url without consuming notes. */
function buildPrescriptionReference(paths) {
    const files = Array.from(paths || []).filter(Boolean);
    if (!files.length) return null;
    return files.length === 1 ? files[0] : JSON.stringify(files);
}

function isPrescriptionFileSetAllowed(files) {
    const allowedTypes = new Set([
        "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"
    ]);
    const maxBytes = 5 * 1024 * 1024;
    const list = Array.from(files || []);
    const invalidType = list.find((file) => !allowedTypes.has(file.type));
    if (invalidType) {
        showToast("نوع الملف غير مدعوم. ارفع JPG أو PNG أو WEBP أو GIF أو PDF.", "error");
        return false;
    }
    const tooLarge = list.find((file) => file.size > maxBytes);
    if (tooLarge) {
        showToast(`حجم الملف ${tooLarge.name} أكبر من الحد المسموح (5 ميجابايت).`, "error");
        return false;
    }
    return true;
}

/** Escapes text before it is written through innerHTML. */
function escText(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Enforces MAX_RX_FILES on a file input (DataTransfer rebuilds a capped
 * FileList) and repaints the dropzone label with every selected file.
 */
function renderRxFileSelection(input, labelId) {
    const label = document.getElementById(labelId);
    if (!label) return;

    let files = Array.from(input.files || []);

    if (files.length > MAX_RX_FILES) {
        files = files.slice(0, MAX_RX_FILES);
        try {
            const dt = new DataTransfer();
            files.forEach((f) => dt.items.add(f));
            input.files = dt.files;
        } catch (err) {
            // DataTransfer unsupported: keep the capped list for display only.
            console.warn("Could not cap file input:", err);
        }
        if (typeof showToast === "function") {
            showToast(`الحد الأقصى ${MAX_RX_FILES} ملفات لكل طلب`, "error");
        }
    }

    if (!files.length) {
        label.textContent = "اضغط هنا لرفع صورة الروشتة أو اسحب الملف";
        label.style.color = "";
        return;
    }

    const shown = files.slice(0, 3);
    const rows = shown
        .map(
            (f, i) =>
                `${i + 1}. ${escText(f.name)} <small>(${(f.size / 1024).toFixed(1)} KB)</small>`
        )
        .join("<br>");

    const extra = files.length > shown.length ? `<br>و ${files.length - shown.length} أخرى...` : "";
    const title =
        files.length === 1
            ? "<strong>تم اختيار ملف:</strong>"
            : `<strong>تم اختيار ${files.length} ملفات:</strong>`;

    label.innerHTML = `${title}<br>${rows}${extra}`;
    label.style.color = "#5A3825";
}

/**
 * Wires a dropzone so several files can be dropped at once (the label
 * already promises "أو اسحب الملف"). Without this the browser's default
 * drop behaviour silently keeps only the last file.
 */
function setupRxDropzone(boxId, inputId, labelId) {
    const box = document.getElementById(boxId);
    const input = document.getElementById(inputId);
    if (!box || !input) return;

    const highlight = (on) => box.classList.toggle("rx-drop-over", on);

    ["dragenter", "dragover"].forEach((evt) =>
        box.addEventListener(evt, (e) => {
            e.preventDefault();
            highlight(true);
        })
    );

    box.addEventListener("dragleave", (e) => {
        if (!box.contains(e.relatedTarget)) highlight(false);
    });

    box.addEventListener("drop", (e) => {
        e.preventDefault();
        highlight(false);

        const dropped = Array.from(e.dataTransfer?.files || []);
        if (!dropped.length) return;

        if (dropped.length > MAX_RX_FILES && typeof showToast === "function") {
            showToast(`الحد الأقصى ${MAX_RX_FILES} ملفات لكل طلب`, "error");
        }

        try {
            const dt = new DataTransfer();
            dropped.slice(0, MAX_RX_FILES).forEach((f) => dt.items.add(f));
            input.files = dt.files;
        } catch (err) {
            console.warn("Could not accept dropped files:", err);
            return;
        }

        renderRxFileSelection(input, labelId);
    });
}

function initRxUploads() {
    setupRxDropzone("rxUploadBox", "rxFileInput", "rxFileLabel");
    setupRxDropzone("modalRxUploadBox", "modalRxFileInput", "modalRxFileLabel");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRxUploads);
} else {
    initRxUploads();
}

/**
 * ==========================================================================
 * صيدلية د.مصطفى فتحي حامد (Dr.Mostafa Fathy Hamed Pharmacy) - Main JavaScript
 * Pure Vanilla JS (ES6+) - No Frameworks
 * ==========================================================================
 */

// --------------------------------------------------------------------------
// 1. Data Store: Products Catalog & Branches
// --------------------------------------------------------------------------
let PRODUCTS_DATA = [];
let CATEGORIES_DATA = [];
let SUBCATEGORIES_DATA = [];

/**
 * Fetches active categories and products from Supabase and builds
 * PRODUCTS_DATA in the same shape the rest of the app already expects,
 * then triggers the first catalog render. Called once on page load.
 */
/**
 * Groups fetched subcategories by their parent category's slug, then
 * replaces the static hardcoded links inside each category's
 * .subcat-dropdown-menu with real, database-driven ones. Falls back to
 * hiding the dropdown entirely for a category that has no subcategories.
 */
/**
 * Builds the entire category navigation bar (one pill per active row in
 * CATEGORIES_DATA, each with its own subcategory dropdown built from
 * SUBCATEGORIES_DATA) and injects it into #categoryNav, right after the
 * static "All" pill. Re-running this replaces all previously generated
 * pills, so it's safe to call again after re-fetching categories.
 */
function renderCategoryNav() {
    const nav = document.getElementById("categoryNav");
    if (!nav) return;

    const allPillWrapper = nav.querySelector(".cat-item-wrapper");

    const byCategory = {};
    SUBCATEGORIES_DATA.forEach(s => {
        if (!byCategory[s.category_id]) byCategory[s.category_id] = [];
        byCategory[s.category_id].push(s);
    });

    const categoryIconMap = {
        medicines: "fa-pills",
        "beauty-care": "fa-wand-magic-sparkles",
        "personal-care": "fa-pump-soap",
        skincare: "fa-hand-sparkles",
        devices: "fa-stethoscope",
        haircare: "fa-scissors",
        baby: "fa-baby-carriage",
        "medical-supplies": "fa-kit-medical"
    };

    const generatedHtml = CATEGORIES_DATA.map(cat => {
        const subcats = byCategory[cat.id] || [];
        const icon = categoryIconMap[cat.slug] || "fa-layer-group";

        const subcatGridHtml = subcats.map(s => `
            <a href="#" class="subcat-link" data-category="${escHtml(cat.slug)}" data-subcategory-id="${escHtml(s.id)}" data-subcategory-name="${escHtml(s.name_ar || "")}">
                <i class="fa-solid ${escHtml(s.icon || 'fa-pills')}"></i>
                <div><strong>${escHtml(s.name_ar)}</strong></div>
            </a>
        `).join("");

        return `
            <div class="cat-item-wrapper">
                <button class="cat-pill" data-category="${escHtml(cat.slug)}">
                    <i class="fa-solid ${icon}"></i>
                    <span>${escHtml(cat.name_ar)}</span>
                    ${subcats.length > 0 ? '<i class="fa-solid fa-chevron-down pill-chevron"></i>' : ""}
                </button>
                ${subcats.length > 0 ? `
                <div class="subcat-dropdown-menu">
                    <div class="subcat-grid">${subcatGridHtml}</div>
                </div>` : ""}
            </div>
        `;
    }).join("");

    nav.innerHTML = "";
    if (allPillWrapper) nav.appendChild(allPillWrapper);
    nav.insertAdjacentHTML("beforeend", generatedHtml);
    nav.querySelectorAll(".cat-pill").forEach(button => {
        button.addEventListener("click", () => filterProductsByCategory(button.dataset.category));
    });
    nav.querySelectorAll(".subcat-link").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            filterBySubcategoryId(link.dataset.category, link.dataset.subcategoryId, link.dataset.subcategoryName);
        });
    });
}

/**
 * Populates the "كل الفئات" dropdown inside the top search bar with the
 * live active categories from Supabase (CATEGORIES_DATA), so any category
 * added/renamed/deactivated in the categories table is reflected on the
 * site automatically without touching the code. Keeps the existing "all"
 * option and preserves whatever value was previously selected, if it
 * still exists among the fresh categories.
 */
function renderSearchCategorySelect() {
    const select = document.getElementById("searchCategorySelect");
    if (!select) return;

    const previousValue = select.value || "all";

    const optionsHtml = CATEGORIES_DATA.map(cat =>
        `<option value="${escHtml(cat.slug)}">${escHtml(cat.name_ar)}</option>`
    ).join("");

    select.innerHTML = `<option value="all">كل الفئات</option>${optionsHtml}`;

    // Restore previous selection if that category still exists
    const stillExists = Array.from(select.options).some(opt => opt.value === previousValue);
    select.value = stillExists ? previousValue : "all";
}

async function loadProductsCatalog() {
    try {
        const { data: categories, error: catError } = await supabaseClient
            .from("categories")
            .select("id, name_ar, slug")
            .eq("is_active", true);

        if (catError) throw catError;

        CATEGORIES_DATA = categories || [];

        const categoryMap = {};
        CATEGORIES_DATA.forEach(c => {
            categoryMap[c.id] = { slug: c.slug, name_ar: c.name_ar };
        });

        // Fetch active subcategories and render them into each category's
        // dropdown menu live, instead of the old hardcoded keyword list.
        const { data: subcats, error: subError } = await supabaseClient
            .from("subcategories")
            .select("id, category_id, name_ar, name_en, icon")
            .eq("is_active", true);

        if (subError) throw subError;

        SUBCATEGORIES_DATA = subcats || [];
        renderCategoryNav();
        renderSearchCategorySelect();

        const { data: products, error: prodError } = await supabaseClient
            .from("products")
            .select("*")
            .eq("is_active", true)
            .order("created_at", { ascending: false });

        if (prodError) throw prodError;

        PRODUCTS_DATA = (products || []).map(p => {
            const cat = categoryMap[p.category_id] || {};
            return {
                id: p.id,
                nameAr: p.name_ar || "",
                nameEn: p.name_en || "",
                category: cat.slug || "medicines",
                categoryName: cat.name_ar || "",
                price: Number(p.price) || 0,
                oldPrice: p.old_price ? Number(p.old_price) : null,
                badge: p.badge || "",
                badgeType: p.badge_type || "official",
                icon: p.icon || "fa-pills",
                imageUrl: p.image_url || null,
                inStock: p.in_stock !== false,
                subcategoryId: p.subcategory_id || null
            };
        });

        renderProductsCatalog();

    } catch (err) {
        console.error("Load products catalog error:", err);
        const grid = document.getElementById("productsCatalogGrid");
        if (grid) {
            grid.innerHTML = `
                <div style="text-align:center; padding:3rem 1rem; color:#EF4444;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem; margin-bottom:0.75rem;"></i>
                    <p>تعذر تحميل قائمة الأدوية والمنتجات حالياً. برجاء تحديث الصفحة أو المحاولة لاحقاً.</p>
                </div>
            `;
        }
    }
}

// NOTE: the old hardcoded BRANCHES_DATA object was removed — the clinic
// booking branch dropdown now uses LIVE_CLINIC_BRANCHES (fetched from
// Supabase's own "clinic_branches" table, kept separate from the pharmacy
// "branches" table so the two never get mixed up). See
// populateClinicBranchOptions() further down.

// --------------------------------------------------------------------------
// 2. Application State
// --------------------------------------------------------------------------
let state = {
    currentCategory: "all",
    activeSubcategory: null,
    activeSubcategoryId: null,
    searchQuery: "",
    inlineSearchQuery: "",
    sortBy: "featured",
    cart: []
};

// Live settings store (from Supabase settings table).
// Any update in the Admin Pharmacy Dashboard is reflected automatically.
let LIVE_SETTINGS = {
    delivery_rules: {
        default_fee: 25,
        free_delivery_threshold: 500,
        estimated_time: "30-45 دقيقة"
    },
    // Contact fields are intentionally empty. They are owned by the dashboard "Settings" page
    // (settings table -> pharmacy_info) and must never be filled with placeholder numbers:
    // an empty value renders as "غير متاح حالياً" instead of publishing a wrong number.
    pharmacy_info: {
        name_ar: "صيدلية د.مصطفى فتحي حامد",
        name_en: "Dr.Mostafa Fathy Hamed Pharmacy",
        hotline: "",
        whatsapp: "",
        email: ""
    },
    social_links: {
        facebook: "",
        instagram: "",
        tiktok: "",
        twitter: ""
    }
};

let DELIVERY_FEE = 25;
let FREE_DELIVERY_THRESHOLD = 500;
let DELIVERY_ESTIMATED_TIME = "30-45 دقيقة";

async function loadLivePharmacySettings() {
    try {
        const { data, error } = await supabaseClient
            .from("settings")
            .select("*");

        if (error) throw error;

        const map = {};
        (data || []).forEach(row => {
            map[row.key] = row.value;
        });

        if (map.delivery_rules) {
            LIVE_SETTINGS.delivery_rules = Object.assign(LIVE_SETTINGS.delivery_rules, map.delivery_rules);
            const fee = Number(map.delivery_rules.default_fee);
            DELIVERY_FEE = Number.isFinite(fee) ? fee : 25;
            const threshold = Number(map.delivery_rules.free_delivery_threshold);
            FREE_DELIVERY_THRESHOLD = Number.isFinite(threshold) ? threshold : 500;
            DELIVERY_ESTIMATED_TIME = map.delivery_rules.estimated_time || "30-45 دقيقة";
        }

        if (map.pharmacy_info) {
            LIVE_SETTINGS.pharmacy_info = Object.assign(LIVE_SETTINGS.pharmacy_info, map.pharmacy_info);
        }

        if (map.social_links) {
            LIVE_SETTINGS.social_links = Object.assign(LIVE_SETTINGS.social_links, map.social_links);
        }

        applySettingsToDOM();
    } catch (err) {
        console.error("Failed to load settings from Supabase:", err);
    }
}

async function loadDeliveryFee() {
    return await loadLivePharmacySettings();
}

function applySettingsToDOM() {
    const { pharmacy_info, social_links } = LIVE_SETTINGS;

    // 1. Hotline
    const hotline = pharmacy_info.hotline || "";
    const topbarHotline = document.getElementById("topbarHotline");
    if (topbarHotline) topbarHotline.textContent = hotline || "غير متاح حالياً";

    const footerHotline = document.getElementById("footerHotlineDisplay");
    if (footerHotline) footerHotline.textContent = hotline || "غير متاح حالياً";

    const floatCall = document.getElementById("floatingCallBtn");
    if (floatCall) {
        if (hotline && hotline !== "غير متوفر حاليا" && hotline !== "غير متاح بعد") {
            const cleanPhone = hotline.replace(/[^\d+]/g, '');
            floatCall.href = `tel:${cleanPhone || hotline}`;
            floatCall.style.display = "flex";
            const tooltip = floatCall.querySelector(".float-tooltip");
            if (tooltip) tooltip.textContent = `الخط الأرضي ${hotline}`;
        } else {
            floatCall.href = "javascript:void(0)";
            floatCall.style.display = "none";
        }
    }

    // 2. WhatsApp
    const wa = pharmacy_info.whatsapp || "";
    const waClean = wa.replace(/\D/g, "");
    const waIntl = waClean.startsWith("0") ? `2${waClean}` : waClean;
    const waUrl = waClean ? `https://wa.me/${waIntl}` : "#";

    const waDisplay = document.getElementById("contactWhatsappDisplay");
    if (waDisplay) waDisplay.textContent = wa || "غير متاح حالياً";

    const waBtn = document.getElementById("contactWhatsappBtn");
    if (waBtn) {
        if (waClean) {
            waBtn.href = waUrl;
            waBtn.style.display = "";
        } else {
            waBtn.removeAttribute("href");
            waBtn.style.display = "none";
        }
    }

    const floatWa = document.getElementById("floatingWhatsappBtn");
    if (floatWa) {
        floatWa.href = waUrl;
        floatWa.style.display = waClean ? "flex" : "none";
    }

    const topbarWa = document.getElementById("topbarWhatsappBtn");
    if (topbarWa) {
        if (waClean) {
            topbarWa.href = waUrl;
            topbarWa.style.display = "inline-flex";
        } else {
            topbarWa.removeAttribute("href");
            topbarWa.style.display = "none";
        }
    }

    // 3b. Hotline in order-success modal
    const successHotlineBtn = document.getElementById("successHotlineBtn");
    const successHotlineText = document.getElementById("successHotlineText");
    if (successHotlineBtn && hotline) {
        const cleanHotline = hotline.replace(/[^\d+]/g, '');
        successHotlineBtn.href = `tel:${cleanHotline || hotline}`;
        if (successHotlineText) successHotlineText.textContent = `الخط الأرضي ${hotline}`;
    }

    // 3c. Hotline in clinic-ticket modal
    const clinicSuccessHotlineBtn = document.getElementById("clinicSuccessHotlineBtn");
    const clinicSuccessHotlineText = document.getElementById("clinicSuccessHotlineText");
    if (clinicSuccessHotlineBtn && hotline) {
        const cleanHotline = hotline.replace(/[^\d+]/g, '');
        clinicSuccessHotlineBtn.href = `tel:${cleanHotline || hotline}`;
        if (clinicSuccessHotlineText) clinicSuccessHotlineText.textContent = `الخط الأرضي ${hotline}`;
    }

    // 3. Email
    const email = pharmacy_info.email || "";
    const emailDisplay = document.getElementById("contactEmailDisplay");
    if (emailDisplay) emailDisplay.textContent = email || "غير متاح حالياً";

    const emailBtn = document.getElementById("contactEmailBtn");
    if (emailBtn) {
        if (email) {
            emailBtn.href = `mailto:${email}`;
            emailBtn.style.display = "";
        } else {
            emailBtn.removeAttribute("href");
            emailBtn.style.display = "none";
        }
    }

    // 4. Social Media Links
    const fbLink = document.getElementById("socialLinkFacebook");
    if (fbLink) {
        if (social_links.facebook) {
            fbLink.href = social_links.facebook;
            fbLink.style.display = "inline-flex";
        } else {
            fbLink.href = "#";
        }
    }
    const topbarFb = document.getElementById("topbarFacebookBtn");
    if (topbarFb && social_links.facebook) topbarFb.href = social_links.facebook;

    const igLink = document.getElementById("socialLinkInstagram");
    if (igLink) {
        if (social_links.instagram) {
            igLink.href = social_links.instagram;
            igLink.style.display = "inline-flex";
        } else {
            igLink.href = "#";
        }
    }
    const topbarIg = document.getElementById("topbarInstagramBtn");
    if (topbarIg && social_links.instagram) topbarIg.href = social_links.instagram;

    const ttLink = document.getElementById("socialLinkTiktok");
    if (ttLink) {
        if (social_links.tiktok) {
            ttLink.href = social_links.tiktok;
            ttLink.style.display = "inline-flex";
        } else {
            ttLink.href = "#";
        }
    }

    const twLink = document.getElementById("socialLinkTwitter");
    if (twLink) {
        if (social_links.twitter) {
            twLink.href = social_links.twitter;
            twLink.style.display = "inline-flex";
        } else {
            twLink.href = "#";
        }
    }
}

function setupRealtimeSettings() {
    try {
        supabaseClient
            .channel("realtime-settings-sync")
            .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, () => {
                console.log("Realtime settings change detected, syncing live...");
                loadLivePharmacySettings();
            })
            .subscribe();
    } catch (e) {
        console.warn("Could not subscribe to settings realtime changes:", e);
    }
}

// Applies the free-delivery-over-threshold rule on top of the base fee.
function calculateDeliveryFee(subtotal) {
    if (FREE_DELIVERY_THRESHOLD > 0 && subtotal >= FREE_DELIVERY_THRESHOLD) {
        return 0;
    }
    return DELIVERY_FEE;
}

// --------------------------------------------------------------------------
// 3. App Initialization
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    setupThemeToggle();

    // Initial products render (fetched live from Supabase)
    loadProductsCatalog();

    // Populate the "nearest branch" delivery selects (main form + quick modal)
    loadDeliveryBranchOptions();

    // Sync required/visible state of pickup vs delivery fields with the
    // radio that's checked by default (pickup)
    toggleDeliveryFields(false);

    // Load live delivery fee, pharmacy info & social media from Supabase settings table
    await loadLivePharmacySettings();
    setupRealtimeSettings();

    // Load pharmacy branches (used by delivery/pickup selects, the branch
    // locator section, and the map — NOT the clinic booking widget).
    await loadLiveBranches();

    // Load clinic branches (separate table: "clinic_branches") and doctors
    // — both feed only the "حجز استشارات طبية" section, kept fully
    // independent from the pharmacy branches above.
    await loadClinicBranches();
    populateClinicBranchOptions();
    await loadDoctorsDirectory();
    setupRealtimeDoctors();

    // Check URL hash for routing
    handleInitialRouting();

    // Setup global search live listener
    setupGlobalSearchListeners();
});

// --------------------------------------------------------------------------
// 3.1 Theme (light / dark mode)
// --------------------------------------------------------------------------
function setupThemeToggle() {
    const savedTheme = localStorage.getItem("pharmacy_theme") || localStorage.getItem("pharmacy-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(savedTheme === "dark" || (!savedTheme && prefersDark));
}

function toggleTheme() {
    const isDark = !document.body.classList.contains("dark-mode");
    applyTheme(isDark);
    localStorage.setItem("pharmacy-theme", isDark ? "dark" : "light");
    localStorage.setItem("pharmacy_theme", isDark ? "dark" : "light");
}

function applyTheme(isDark) {
    const toggle = document.getElementById("themeToggle");
    document.body.classList.toggle("dark-mode", isDark);

    if (!toggle) return;

    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute("aria-label", isDark ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي");
    toggle.innerHTML = isDark
        ? '<i class="fa-solid fa-sun" aria-hidden="true"></i><span>الوضع النهاري</span>'
        : '<i class="fa-solid fa-moon" aria-hidden="true"></i><span>الوضع الليلي</span>';
}

// --------------------------------------------------------------------------
// 4. Navigation & Section Switching
// --------------------------------------------------------------------------
function switchSection(sectionId) {
    const sections = document.querySelectorAll(".app-section");
    const navLinks = document.querySelectorAll(".nav-link");

    // Update section active state
    sections.forEach(sec => {
        if (sec.id === `section-${sectionId}`) {
            sec.classList.add("active");
        } else {
            sec.classList.remove("active");
        }
    });

    // Update nav links active state
    navLinks.forEach(link => {
        if (link.getAttribute("data-section") === sectionId) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // Close mobile menu if opened
    const mainNav = document.getElementById("mainNav");
    if (mainNav.classList.contains("mobile-active")) {
        mainNav.classList.remove("mobile-active");
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Update URL hash without jumping
    history.replaceState(null, null, `#${sectionId}`);
}

function handleInitialRouting() {
    const hash = window.location.hash.replace("#", "");
    if (hash && ["home", "products", "consultations", "about", "contact"].includes(hash)) {
        switchSection(hash);
    }
}

function toggleMobileMenu() {
    const mainNav = document.getElementById("mainNav");
    mainNav.classList.toggle("mobile-active");
}

// --------------------------------------------------------------------------
// 5. Products Catalog Logic & Nahdi Filtering with Subcategories
// --------------------------------------------------------------------------
function renderProductsCatalog() {
    const grid = document.getElementById("productsCatalogGrid");
    const emptyState = document.getElementById("emptyProductsState");

    if (!grid) return;

    // Filter products
    let filtered = PRODUCTS_DATA.filter(item => {
        // Category Match
        const matchCategory = state.currentCategory === "all" || item.category === state.currentCategory;
        
        // Subcategory Match (real relational match, not keyword guessing)
        let matchSubcategory = true;
        if (state.activeSubcategoryId) {
            matchSubcategory = item.subcategoryId === state.activeSubcategoryId;
        }

        // Search Match (Global or Inline)
        const activeSearch = (state.searchQuery || state.inlineSearchQuery).trim().toLowerCase();
        const matchSearch = !activeSearch || 
            item.nameAr.toLowerCase().includes(activeSearch) || 
            item.nameEn.toLowerCase().includes(activeSearch) ||
            item.categoryName.toLowerCase().includes(activeSearch);

        return matchCategory && matchSubcategory && matchSearch;
    });

    // Sort products
    if (state.sortBy === "price-asc") {
        filtered.sort((a, b) => a.price - b.price);
    } else if (state.sortBy === "price-desc") {
        filtered.sort((a, b) => b.price - a.price);
    } else if (state.sortBy === "name") {
        filtered.sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'));
    }

    // Render HTML
    if (filtered.length === 0) {
        grid.innerHTML = "";
        emptyState.style.display = "block";
    } else {
        emptyState.style.display = "none";
        grid.innerHTML = filtered.map(product => {
            const badgeClass = product.badgeType === "discount" ? "badge-discount" : "badge-official";
            const oldPriceHtml = product.oldPrice ? `<span class="old-price">${product.oldPrice.toFixed(2)} ج.م</span>` : "";
            const badgeHtml = product.badge ? `<span class="product-badge-tag ${badgeClass}">${escHtml(product.badge)}</span>` : "";
            const imageHtml = product.imageUrl
                ? `<img src="${escHtml(product.imageUrl)}" alt="${escHtml(product.nameAr)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
                : `<i class="fa-solid ${escHtml(product.icon)}"></i>`;

            return `
                <div class="product-card" data-id="${escHtml(product.id)}">
                    ${badgeHtml}
                    <div class="product-img-wrap">
                        ${imageHtml}
                    </div>
                    <span class="product-cat-name">${escHtml(product.categoryName)}</span>
                    <h4 class="product-name">${escHtml(product.nameAr)}</h4>
                    <span class="product-en-name">${escHtml(product.nameEn)}</span>
                    
                    <div class="product-price-row">
                        <span class="current-price">${product.price.toFixed(2)} ج.م</span>
                        ${oldPriceHtml}
                    </div>

                    <button class="btn-add-order" onclick="addToCart('${escHtml(product.id)}')">
                        <i class="fa-solid fa-cart-plus"></i>
                        <span>إضافة للطلب</span>
                    </button>
                </div>
            `;
        }).join("");
    }
}

function filterProductsByCategory(category) {
    state.currentCategory = category;
    clearSubcategoryFilter(false);

    // Update pill buttons
    const pills = document.querySelectorAll(".cat-pill");
    pills.forEach(pill => {
        if (pill.getAttribute("data-category") === category) {
            pill.classList.add("active");
        } else {
            pill.classList.remove("active");
        }
    });

    // Tap-to-open the subcategory dropdown on touch devices. The panel's
    // visibility is controlled via opacity/visibility/pointer-events (a
    // fade transition), NOT display — so those are the properties that
    // must be toggled inline to override the :hover-only CSS rule, which
    // never fires on a touch device.
    const clickedWrapper = [...document.querySelectorAll(".cat-item-wrapper .cat-pill")]
        .find(pill => pill.dataset.category === category)
        ?.closest(".cat-item-wrapper");
    const clickedMenu = clickedWrapper?.querySelector(".subcat-dropdown-menu");
    const isCurrentlyOpen = clickedMenu && clickedMenu.style.visibility === "visible";

    document.querySelectorAll(".cat-item-wrapper .subcat-dropdown-menu").forEach(menu => {
        const shouldOpen = menu === clickedMenu && !isCurrentlyOpen;
        menu.style.opacity = shouldOpen ? "1" : "0";
        menu.style.visibility = shouldOpen ? "visible" : "hidden";
        menu.style.pointerEvents = shouldOpen ? "auto" : "none";
        menu.style.transform = shouldOpen ? "translateY(0)" : "translateY(10px)";

        // Keep the wrapper's own z-index in sync with its dropdown's
        // visibility, so the open one always paints above sibling
        // category pills instead of losing a z-index tie by DOM order.
        const wrapper = menu.closest(".cat-item-wrapper");
        if (wrapper) wrapper.classList.toggle("dropdown-open", shouldOpen);
    });

    renderProductsCatalog();
}

function filterBySubcategoryId(parentCategory, subcategoryId, subcategoryTitle) {
    state.currentCategory = parentCategory;
    state.activeSubcategory = subcategoryTitle;
    state.activeSubcategoryId = subcategoryId;

    // Update category pill active state
    const pills = document.querySelectorAll(".cat-pill");
    pills.forEach(pill => {
        if (pill.getAttribute("data-category") === parentCategory) {
            pill.classList.add("active");
        } else {
            pill.classList.remove("active");
        }
    });

    // Update Active Subcategory Indicator Bar
    const bar = document.getElementById("activeSubcatBar");
    const titleEl = document.getElementById("activeSubcatTitle");
    if (bar && titleEl) {
        titleEl.textContent = subcategoryTitle;
        bar.style.display = "flex";
    }

    renderProductsCatalog();

    // Close any open subcategory panel now that a choice was made
    document.querySelectorAll(".cat-item-wrapper .subcat-dropdown-menu").forEach(menu => {
        menu.style.opacity = "0";
        menu.style.visibility = "hidden";
        menu.style.pointerEvents = "none";
        menu.style.transform = "translateY(10px)";
        menu.closest(".cat-item-wrapper")?.classList.remove("dropdown-open");
    });

    showToast(`تمت التصفية حسب: ${subcategoryTitle}`, "success");
}

function clearSubcategoryFilter(shouldReRender = true) {
    state.activeSubcategory = null;
    state.activeSubcategoryId = null;

    const bar = document.getElementById("activeSubcatBar");
    if (bar) {
        bar.style.display = "none";
    }

    if (shouldReRender) {
        renderProductsCatalog();
    }
}

function filterBySpecificCategory(category) {
    switchSection("products");
    filterProductsByCategory(category);
}

function handleCategoryFilter(category) {
    switchSection("products");
    filterProductsByCategory(category);
}

function handleInlineSearch(val) {
    state.inlineSearchQuery = val;
    renderProductsCatalog();
}

function handleProductSort(sortBy) {
    state.sortBy = sortBy;
    renderProductsCatalog();
}

// --------------------------------------------------------------------------
// 6. Nahdi-Style Smart Search Header Listeners
// --------------------------------------------------------------------------
function setupGlobalSearchListeners() {
    const searchInput = document.getElementById("globalSearchInput");
    const dropdown = document.getElementById("searchResultsDropdown");
    const dropdownList = document.getElementById("searchDropdownList");
    const dropdownCount = document.getElementById("dropdownResultsCount");
    const btnClear = document.getElementById("btnClearSearch");

    if (!searchInput) return;

    searchInput.addEventListener("input", (e) => {
        const query = e.target.value.trim().toLowerCase();
        state.searchQuery = query;

        // Respect the category picked in the "كل الفئات" dropdown (Supabase-driven),
        // so choosing a category narrows the live search results to it.
        const categorySelect = document.getElementById("searchCategorySelect");
        const selectedCategory = categorySelect ? categorySelect.value : "all";

        if (query.length > 0) {
            btnClear.style.display = "block";
            
            // Search in data
            const matches = PRODUCTS_DATA.filter(p => {
                const matchesCategory = selectedCategory === "all" || p.category === selectedCategory;
                const matchesQuery =
                    p.nameAr.toLowerCase().includes(query) ||
                    p.nameEn.toLowerCase().includes(query) ||
                    p.categoryName.toLowerCase().includes(query);
                return matchesCategory && matchesQuery;
            });

            dropdownCount.textContent = `${matches.length} منتجات`;

            if (matches.length > 0) {
                dropdownList.innerHTML = matches.slice(0, 6).map(p => `
                    <div class="search-dropdown-item" onclick="selectSearchItem('${escHtml(p.id)}')">
                        <div class="search-item-info">
                            <div class="search-item-icon"><i class="fa-solid ${escHtml(p.icon)}"></i></div>
                            <div>
                                <div class="search-item-title">${escHtml(p.nameAr)}</div>
                                <div class="search-item-category">${escHtml(p.categoryName)} - ${escHtml(p.nameEn)}</div>
                            </div>
                        </div>
                        <div class="search-item-price">${p.price.toFixed(2)} ج.م</div>
                    </div>
                `).join("");
                dropdown.classList.add("active");
            } else {
                dropdownList.innerHTML = `
                    <div style="padding: 1.5rem; text-align: center; color: #6B584A;">
                        لا توجد نتائج مطابقة لـ "<strong>${escHtml(e.target.value)}</strong>"<br>
                        <button class="btn btn-link" style="margin-top: 0.5rem;" onclick="openPrescriptionModal()">طلب توفير هذا الدواء</button>
                    </div>
                `;
                dropdown.classList.add("active");
            }
        } else {
            btnClear.style.display = "none";
            dropdown.classList.remove("active");
        }
    });

    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".search-bar-container")) {
            dropdown.classList.remove("active");
        }
    });
}

function clearSearch() {
    const searchInput = document.getElementById("globalSearchInput");
    const btnClear = document.getElementById("btnClearSearch");
    const dropdown = document.getElementById("searchResultsDropdown");
    
    if (searchInput) searchInput.value = "";
    if (btnClear) btnClear.style.display = "none";
    if (dropdown) dropdown.classList.remove("active");
    
    state.searchQuery = "";
    renderProductsCatalog();
}

function executeSearch() {
    const searchInput = document.getElementById("globalSearchInput");
    const dropdown = document.getElementById("searchResultsDropdown");
    if (dropdown) dropdown.classList.remove("active");
    
    switchSection("products");
    renderProductsCatalog();
}

function selectSearchItem(productId) {
    const dropdown = document.getElementById("searchResultsDropdown");
    if (dropdown) dropdown.classList.remove("active");

    switchSection("products");
    const product = PRODUCTS_DATA.find(p => p.id === productId);
    if (product) {
        addToCart(productId);
        showToast(`تمت إضافة "${product.nameAr}" لسلة الطلبات`, "success");
    }
}

// --------------------------------------------------------------------------
// 7. Cart & Orders Drawer Logic
// --------------------------------------------------------------------------
function addToCart(productId) {
    const product = PRODUCTS_DATA.find(p => p.id === productId);
    if (!product) return;

    const existingIndex = state.cart.findIndex(item => item.id === productId);
    if (existingIndex > -1) {
        state.cart[existingIndex].quantity += 1;
    } else {
        state.cart.push({
            id: product.id,
            nameAr: product.nameAr,
            price: product.price,
            icon: product.icon,
            quantity: 1
        });
    }

    updateCartUI();
    showToast(`تمت إضافة ${product.nameAr} إلى قائمة طلباتك`, "success");
}

function updateCartUI() {
    const badge = document.getElementById("cartCountBadge");
    const cartList = document.getElementById("cartDrawerItems");
    const cartTotalPrice = document.getElementById("cartTotalPrice");

    const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (badge) badge.textContent = totalCount;
    if (cartTotalPrice) cartTotalPrice.textContent = `${totalPrice.toFixed(2)} ج.م`;

    // Update delivery fee info
    const deliveryFeeRow = document.getElementById("cartDeliveryFeeRow");
    const deliveryFeeValue = document.getElementById("cartDeliveryFeeValue");
    const freeDeliveryRow = document.getElementById("cartFreeDeliveryRow");
    const freeDeliveryThreshold = document.getElementById("cartFreeDeliveryThreshold");

    if (deliveryFeeRow && deliveryFeeValue) {
        if (totalPrice > 0) {
            const isFreeDelivery = FREE_DELIVERY_THRESHOLD > 0 && totalPrice >= FREE_DELIVERY_THRESHOLD;
            deliveryFeeValue.textContent = isFreeDelivery ? "مجاني" : `${DELIVERY_FEE.toFixed(2)} ج.م`;
            deliveryFeeValue.style.color = isFreeDelivery ? "var(--success, #16a34a)" : "";
            deliveryFeeRow.style.display = "flex";
        } else {
            deliveryFeeRow.style.display = "none";
        }
    }

    if (freeDeliveryRow && freeDeliveryThreshold) {
        if (FREE_DELIVERY_THRESHOLD > 0 && totalPrice > 0 && totalPrice < FREE_DELIVERY_THRESHOLD) {
            const remaining = (FREE_DELIVERY_THRESHOLD - totalPrice).toFixed(2);
            freeDeliveryThreshold.textContent = `${FREE_DELIVERY_THRESHOLD.toFixed(2)} ج.م`;
            freeDeliveryRow.querySelector("span:first-child").innerHTML = `<i class="fa-solid fa-truck-fast"></i> أضف ${remaining} ج.م للتوصيل المجاني`;
            freeDeliveryRow.style.display = "flex";
        } else if (totalPrice > 0 && FREE_DELIVERY_THRESHOLD > 0 && totalPrice >= FREE_DELIVERY_THRESHOLD) {
            freeDeliveryRow.querySelector("span:first-child").innerHTML = `<i class="fa-solid fa-truck-fast"></i> مبروك! طلبك مؤهل للتوصيل المجاني`;
            freeDeliveryThreshold.textContent = "";
            freeDeliveryRow.style.display = "flex";
        } else {
            freeDeliveryRow.style.display = "none";
        }
    }

    if (!cartList) return;

    if (state.cart.length === 0) {
        cartList.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: #9A8B7E;">
                <i class="fa-solid fa-basket-shopping" style="font-size: 3rem; margin-bottom: 1rem; color: #CBD5E1;"></i>
                <p>قائمة الطلبات فارغة حالياً</p>
                <button class="btn btn-primary" style="margin-top: 1rem;" onclick="toggleCartDrawer(); switchSection('products');">تصفح الأدوية والتجميل</button>
            </div>
        `;
    } else {
        cartList.innerHTML = state.cart.map(item => `
            <div class="cart-item">
                <div class="cart-item-details">
                    <h5>${escHtml(item.nameAr)}</h5>
                    <div class="cart-item-price">${(item.price * item.quantity).toFixed(2)} ج.م (${item.price.toFixed(2)} ج.م للواحد)</div>
                </div>
                <div class="cart-item-actions">
                    <button class="btn-qty" onclick="updateItemQuantity('${escHtml(item.id)}', -1)">-</button>
                    <span style="font-weight: 700; min-width: 20px; text-align: center;">${item.quantity}</span>
                    <button class="btn-qty" onclick="updateItemQuantity('${escHtml(item.id)}', 1)">+</button>
                    <button class="btn-qty" style="color: #EF4444;" onclick="removeItemFromCart('${escHtml(item.id)}')" title="حذف"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `).join("");
    }
}

function updateItemQuantity(productId, delta) {
    const item = state.cart.find(i => i.id === productId);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        state.cart = state.cart.filter(i => i.id !== productId);
    }

    updateCartUI();
}

function removeItemFromCart(productId) {
    state.cart = state.cart.filter(i => i.id !== productId);
    updateCartUI();
}

function toggleCartDrawer() {
    const drawer = document.getElementById("cartDrawer");
    if (drawer) {
        drawer.classList.toggle("active");
    }
}

function checkoutFromCart() {
    toggleCartDrawer();
    switchSection("products");

    // Populate order textarea with cart items
    const medicineInput = document.getElementById("orderMedicineNames");
    if (medicineInput && state.cart.length > 0) {
        const orderSummary = state.cart.map(item => `${item.nameAr} (العدد: ${item.quantity})`).join(" + ");
        medicineInput.value = orderSummary;
    }

    // Scroll smoothly to the booking form
    const bookingForm = document.getElementById("bookingFormContainer");
    if (bookingForm) {
        bookingForm.scrollIntoView({ behavior: "smooth" });
    }
}

// --------------------------------------------------------------------------
// 8. Medicine Booking & Delivery Toggle Logic
// --------------------------------------------------------------------------
async function loadDeliveryBranchOptions() {
    const selects = [
        document.getElementById("orderDeliveryBranch"),
        document.getElementById("modalDeliveryBranch")
    ].filter(Boolean);

    if (selects.length === 0) return;

    try {
        const { data: branches, error } = await supabaseClient
            .from("branches")
            .select("id, name_ar, city")
            .eq("is_active", true)
            .order("name_ar");

        if (error) throw error;

        const optionsHtml = (branches || [])
            .map(b => `<option value="${escHtml(b.id)}">${escHtml(b.name_ar)}${b.city ? ` (${escHtml(formatCityName(b.city))})` : ''}</option>`)
            .join("");

        selects.forEach(select => {
            select.innerHTML =
                `<option value="" disabled selected>-- اختر الفرع الأقرب لعنوانك --</option>` +
                optionsHtml;
        });
    } catch (err) {
        console.error("Failed to load branches for delivery selects:", err);
    }
}

function toggleDeliveryFields(isDelivery) {
    const branchGroup = document.getElementById("branchSelectorGroup");
    const addressWrapper = document.getElementById("deliveryAddressWrapper");
    const pickupBranchEl = document.getElementById("orderBranch");
    const deliveryBranchEl = document.getElementById("orderDeliveryBranch");

    if (isDelivery) {
        if (branchGroup) branchGroup.style.display = "none";
        if (addressWrapper) addressWrapper.style.display = "block";
        if (deliveryBranchEl) deliveryBranchEl.required = true;
        if (pickupBranchEl) pickupBranchEl.required = false;
    } else {
        if (branchGroup) branchGroup.style.display = "block";
        if (addressWrapper) addressWrapper.style.display = "none";
        if (deliveryBranchEl) {
            deliveryBranchEl.required = false;
            deliveryBranchEl.value = "";
        }
        if (pickupBranchEl) pickupBranchEl.required = false;
    }
}

function handleFileSelect(event) {
    renderRxFileSelection(event.target, "rxFileLabel");
}

async function handleMedicineOrderSubmit(event) {
    event.preventDefault();

    // Get basic customer information
    const medicines = document.getElementById("orderMedicineNames").value.trim();
    const name = document.getElementById("orderPatientName").value.trim();
    const phone = document.getElementById("orderPhone").value.trim();

    const deliveryMethodElement = document.querySelector(
        'input[name="deliveryMethod"]:checked'
    );

    if (!deliveryMethodElement) {
        showToast("يرجى اختيار طريقة استلام الطلب", "error");
        return;
    }

    const deliveryMethod = deliveryMethodElement.value;

    // Egyptian phone validation
    const phoneRegex = /^01[0125][0-9]{8}$/;

    if (!phoneRegex.test(phone)) {
        showToast(
            "يرجى إدخال رقم هاتف مصري صحيح يبدأ بـ 010 أو 011 أو 012 أو 015 ومكون من 11 رقماً",
            "error"
        );
        return;
    }

    // Tracking number, subtotal, delivery fee and total now all come back
    // from the create_order() database function after it succeeds — the
    // browser no longer generates or sends any of these itself.
    let trackingCode = "";

    // Prepare delivery information
    let deliveryText = "";
    let addressText = "";
    let selectedBranchId = null;

    if (deliveryMethod === "delivery") {

        const gov = document.getElementById("orderGov").value;
        const city = document.getElementById("orderCity").value.trim();
        const street = document.getElementById("orderStreet").value.trim();
        const building = document.getElementById("orderBuilding").value.trim();
        const apartment = document.getElementById("orderApartment").value.trim();
        const landmark = document.getElementById("orderLandmark").value.trim();
        const gpsLink = document.getElementById("mainGpsCoordinates").value.trim();

        const deliveryBranchEl = document.getElementById("orderDeliveryBranch");
        selectedBranchId = deliveryBranchEl?.value || "";
        const nearestBranchName =
            deliveryBranchEl?.options[deliveryBranchEl.selectedIndex]?.text || "";

        if (!selectedBranchId) {
            showToast("يرجى اختيار أقرب فرع لك", "error");
            return;
        }

        deliveryText = "توصيل للمنزل";

        addressText =
            `أقرب فرع: ${nearestBranchName}\n` +
            `المحافظة: ${gov}\n` +
            `المنطقة: ${city}\n` +
            `الشارع: ${street}\n` +
            `رقم العمارة: ${building}\n` +
            `الشقة والدور: ${apartment || "غير محدد"}\n` +
            `علامة مميزة: ${landmark || "لا يوجد"}\n` +
            `GPS: ${gpsLink || "غير محدد"}`;

    } else {

        const branchSelectEl = document.getElementById("orderBranch");
        selectedBranchId = branchSelectEl.value; // UUID الفرع من جدول branches
        const branchName = branchSelectEl.options[branchSelectEl.selectedIndex].text;

        deliveryText = `استلام من الصيدلية - ${branchName}`;

        addressText = branchName;
    }

    // Additional notes
    let notes = document.getElementById("orderNotes").value.trim();

    // Selected prescription files (if any). A prescription may carry up to
    // MAX_RX_FILES images: the first one feeds the single prescription_url
    // column, and every URL is appended to the notes so nothing is lost.
    const rxFileInput = document.getElementById("rxFileInput");
    const selectedRxFiles = Array.from(rxFileInput?.files || []).slice(0, MAX_RX_FILES);
    if (!isPrescriptionFileSetAllowed(selectedRxFiles)) return;

    // Disable submit button while sending
    const submitButton = event.target.querySelector('button[type="submit"]');

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin"></i>
            جاري إرسال الطلب...
        `;
    }

    try {

    // Upload prescription images before creating the order. Keep attachment
    // paths in prescription_url; notes are limited to 200 characters by SQL.
    let prescriptionUrl = null;

    if (selectedRxFiles.length) {
        const { urls, failedNames } = await uploadPrescriptionFiles(selectedRxFiles);
        if (failedNames.length) {
            showToast(
                `تعذر رفع بعض الملفات (${failedNames.join("، ")}). لم يتم إنشاء الطلب، حاول مرة أخرى.`,
                "error"
            );
            return;
        }
        prescriptionUrl = buildPrescriptionReference(urls);
        }

        // Cart line items sent as {product_id, quantity} only — no prices.
        // The database computes subtotal from the real, current product
        // prices (and the delivery fee from live settings), so nothing
        // price-related the browser sends can be tampered with.
        const cartItems = state.cart.map(item => ({
            product_id: item.id,
            quantity: item.quantity
        }));

        // Call the create_order database function instead of inserting
        // into `orders` directly.
        const { data: orderResult, error } = await supabaseClient.rpc(
            "create_order",
            {
                p_customer_name: name,
                p_phone: phone,
                p_order_type: deliveryMethod === "delivery" ? "delivery" : "pickup",
                p_branch_id: selectedBranchId,
                p_address: addressText,
                p_notes: notes,
                p_prescription_url: prescriptionUrl,
                p_medications_text: medicines,
                p_items: cartItems
            }
        );

        // Check for database error
        if (error) {
            console.error("Supabase order error:", error);

            showToast(
                "حدث خطأ أثناء إرسال الطلب. يرجى المحاولة مرة أخرى.",
                "error"
            );

            return;
        }

        // create_order() returns an array with one row: order_id,
        // tracking_code, subtotal, delivery_fee, total — all computed
        // server-side from real data.
        const orderRow = Array.isArray(orderResult) ? orderResult[0] : orderResult;
        trackingCode = orderRow.tracking_code;
        const subtotal = Number(orderRow.subtotal);
        const deliveryFeeValue = Number(orderRow.delivery_fee);
        const total = Number(orderRow.total);

        console.log("Order successfully created:", trackingCode);

        // NOTE: detailed per-product line items (order_items) aren't linked
        // yet — that needs the new order's id back from Supabase, which
        // requires either a SELECT policy on `orders` or (safer) a
        // database RPC function. See note below the code for the SQL to
        // enable that as a follow-up.

        // Show success information
        document.getElementById("successTrackingNumber").textContent =
            trackingCode;

        document.getElementById("successPatientName").textContent =
            name;

        document.getElementById("successPhone").textContent =
            phone;

        document.getElementById("successDeliveryType").textContent =
            deliveryText;

        const subtotalRow = document.getElementById("successSubtotalRow");
        const subtotalEl = document.getElementById("successSubtotal");
        const deliveryFeeRowEl = document.getElementById("successDeliveryFeeRow");
        const deliveryFeeEl = document.getElementById("successDeliveryFee");
        const totalRow = document.getElementById("successTotalRow");
        const totalEl = document.getElementById("successOrderTotal");

        if (subtotalRow && subtotalEl) {
            subtotalEl.textContent = `${subtotal.toFixed(2)} ج.م`;
            subtotalRow.style.display = subtotal > 0 ? "flex" : "none";
        }

        if (deliveryFeeRowEl && deliveryFeeEl) {
            if (deliveryMethod === "delivery") {
                deliveryFeeEl.textContent = deliveryFeeValue === 0
                    ? "0.00 ج.م (توصيل مجاني)"
                    : `${deliveryFeeValue.toFixed(2)} ج.م`;
                deliveryFeeEl.style.color = deliveryFeeValue === 0 ? "#16a34a" : "";
                deliveryFeeRowEl.style.display = "flex";
            } else {
                deliveryFeeRowEl.style.display = "none";
            }
        }

        if (totalRow && totalEl && (subtotal > 0 || deliveryMethod === "delivery")) {
            const finalTotal = subtotal + deliveryFeeValue;
            totalEl.textContent = `${finalTotal.toFixed(2)} ج.م`;
            totalRow.style.display = "flex";
        } else if (totalRow) {
            totalRow.style.display = "none";
        }

        const estimatedTimeEl = document.getElementById("successEstimatedTime");
        if (estimatedTimeEl && DELIVERY_ESTIMATED_TIME) {
            estimatedTimeEl.textContent = `خلال ${DELIVERY_ESTIMATED_TIME}`;
        }

        const successModal =
            document.getElementById("orderSuccessModal");

        if (successModal) {
            successModal.classList.add("active");
        }

        // Reset form
        event.target.reset();

        // Reset cart
        state.cart = [];
        updateCartUI();

        // Reset prescription label
        const rxLabel =
            document.getElementById("rxFileLabel");

        if (rxLabel) {
            rxLabel.textContent =
                "اضغط هنا لرفع صورة الروشتة أو اسحب الملف";
        }

        // Reset GPS
        const mainLocStatus =
            document.getElementById("mainLocationStatus");

        if (mainLocStatus) {
            mainLocStatus.textContent = "";
            mainLocStatus.className =
                "location-status-badge";
        }

        const mainGps =
            document.getElementById("mainGpsCoordinates");

        if (mainGps) {
            mainGps.value = "";
        }

        toggleDeliveryFields(false);

    } catch (error) {

        console.error("Unexpected order error:", error);

        showToast(
            "حدث خطأ غير متوقع أثناء إرسال الطلب.",
            "error"
        );

    } finally {

        // Re-enable submit button
        if (submitButton) {
            submitButton.disabled = false;

            submitButton.innerHTML = `
                <i class="fa-solid fa-paper-plane"></i>
                تأكيد وإرسال طلب الأدوية
            `;
        }
    }
}

// --------------------------------------------------------------------------
// 9. Quick Prescription Modal Handlers & GPS Geolocation
// --------------------------------------------------------------------------
function openPrescriptionModal() {
    const modal = document.getElementById("prescriptionModal");
    if (modal) modal.classList.add("active");
}

function closePrescriptionModal() {
    const modal = document.getElementById("prescriptionModal");
    if (modal) modal.classList.remove("active");
}

function handleModalFileSelect(event) {
    renderRxFileSelection(event.target, "modalRxFileLabel");
}

function toggleModalDeliveryLocation(isDelivery) {
    const locationBox = document.getElementById("modalDeliveryLocationBox");
    const branchBox = document.getElementById("modalBranchSelectBox");
    const deliveryBranchEl = document.getElementById("modalDeliveryBranch");

    if (isDelivery) {
        if (locationBox) locationBox.style.display = "flex";
        if (branchBox) branchBox.style.display = "none";
        if (deliveryBranchEl) deliveryBranchEl.required = true;
    } else {
        if (locationBox) locationBox.style.display = "none";
        if (branchBox) branchBox.style.display = "flex";
        if (deliveryBranchEl) {
            deliveryBranchEl.required = false;
            deliveryBranchEl.value = "";
        }
    }
}

function detectUserLocation(context = 'modal') {
    const statusEl = document.getElementById(context === 'modal' ? 'modalLocationStatus' : 'mainLocationStatus');
    const gpsInput = document.getElementById(context === 'modal' ? 'modalGpsCoordinates' : 'mainGpsCoordinates');
    const addressInput = document.getElementById(context === 'modal' ? 'modalAddressDetails' : 'orderCity');

    if (!navigator.geolocation) {
        if (statusEl) {
            statusEl.className = "location-status-badge error";
            statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> المتصفح لا يدعم تحديد الموقع';
        }
        showToast("المتصفح لا يدعم خدمة تحديد الموقع التلقائي", "error");
        return;
    }

    if (statusEl) {
        statusEl.className = "location-status-badge loading";
        statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التقاط إحداثيات موقعك بدقة...';
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude.toFixed(6);
            const lng = position.coords.longitude.toFixed(6);
            const accuracy = Math.round(position.coords.accuracy);
            const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;

            if (gpsInput) gpsInput.value = mapsUrl;

            if (statusEl) {
                statusEl.className = "location-status-badge success";
                statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> تم تحديد موقعك بدقة (دقة: ${accuracy}م) <a href="${mapsUrl}" target="_blank" style="text-decoration: underline; color: #15803D; margin-right: 4px;">عرض</a>`;
            }

            if (addressInput && !addressInput.value) {
                addressInput.value = `موقع محدد عبر GPS (خط عرض: ${lat}، خط طول: ${lng})`;
            }

            showToast("تم التقاط موقعك الجغرافي بدقة وتثبيته في الطلب! 📍", "success");
        },
        (error) => {
            let errorMsg = "تعذر الحصول على الموقع";
            if (error.code === error.PERMISSION_DENIED) {
                errorMsg = "تم رفض الإذن بالوصول للموقع. يرجى كتابة العنوان يدوياً.";
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                errorMsg = "معلومات الموقع غير متوفرة حالياً.";
            } else if (error.code === error.TIMEOUT) {
                errorMsg = "انتهت مهلة طلب الموقع.";
            }

            if (statusEl) {
                statusEl.className = "location-status-badge error";
                statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${errorMsg}`;
            }

            showToast(errorMsg, "error");
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

async function handleQuickRxModalSubmit(event) {
    event.preventDefault();

    // Customer information
    const name = document.getElementById("modalRxName").value.trim();
    const phone = document.getElementById("modalRxPhone").value.trim();

    // Medicines / prescription text
    const medicines = document.getElementById("modalRxText").value.trim();

    // Delivery method
    const methodElement = document.querySelector(
        'input[name="modalDeliveryMethod"]:checked'
    );

    if (!methodElement) {
        showToast("يرجى اختيار طريقة الاستلام", "error");
        return;
    }

    const method = methodElement.value;

    // Validate Egyptian phone
    const phoneRegex = /^01[0125][0-9]{8}$/;

    if (!phoneRegex.test(phone)) {
        showToast(
            "يرجى إدخال رقم هاتف مصري صحيح مكون من 11 رقماً",
            "error"
        );
        return;
    }

    // Tracking number now comes back from the create_order() database
    // function after it succeeds.
    let trackingCode = "";

    // Delivery information
    let deliveryDescription = "";
    let address = "";
    let selectedBranchId = null;

    if (method === "delivery") {

        address =
            document.getElementById("modalAddressDetails")?.value.trim() || "";

        const gpsLink =
            document.getElementById("modalGpsCoordinates")?.value.trim() || "";

        const deliveryBranchEl = document.getElementById("modalDeliveryBranch");
        selectedBranchId = deliveryBranchEl?.value || "";
        const nearestBranchName =
            deliveryBranchEl?.options[deliveryBranchEl.selectedIndex]?.text || "";

        if (!selectedBranchId) {
            showToast("يرجى اختيار أقرب فرع لك", "error");
            return;
        }

        deliveryDescription = "توصيل للمنزل";

        address = `أقرب فرع: ${nearestBranchName}\n${address}`;

        if (gpsLink) {
            address = `${address}\nGPS: ${gpsLink}`;
        }

    } else {

        const modalBranchEl = document.getElementById("modalBranchSelect");
        selectedBranchId = modalBranchEl?.value || null;
        const branchName = modalBranchEl?.options[modalBranchEl.selectedIndex]?.text || "";

        deliveryDescription = `استلام من الفرع - ${branchName}`;
        address = branchName;
    }

    // Selected prescription files
    const fileInput =
        document.getElementById("modalRxFileInput");

    const selectedFiles =
        Array.from(fileInput?.files || []).slice(0, MAX_RX_FILES);
    if (!isPrescriptionFileSetAllowed(selectedFiles)) return;

    // Disable submit button
    const submitButton =
        event.target.querySelector('button[type="submit"]');

    if (submitButton) {
        submitButton.disabled = true;

        submitButton.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin"></i>
            جاري إرسال الطلب...
        `;
    }

    try {

        // Keep every uploaded path in prescription_url. Putting multiple URLs
        // in p_notes exceeded the database's 200-character validation limit.
        let prescriptionUrl = null;
        let modalNotes = "";

        if (selectedFiles.length) {
            const { urls, failedNames } = await uploadPrescriptionFiles(selectedFiles);
            if (failedNames.length) {
                showToast(
                    `تعذر رفع بعض الملفات (${failedNames.join("، ")}). لم يتم إنشاء الطلب، حاول مرة أخرى.`,
                    "error"
                );
                return;
            }
            prescriptionUrl = buildPrescriptionReference(urls);
        }

        // This quick-order flow has no priced cart items (empty items
        // array), so the database always sets subtotal to 0. The delivery
        // fee is still computed server-side from live settings.
        const { data: orderResult, error } = await supabaseClient.rpc(
            "create_order",
            {
                p_customer_name: name,
                p_phone: phone,
                p_order_type: method === "delivery" ? "delivery" : "pickup",
                p_branch_id: selectedBranchId,
                p_address: address,
                p_notes: modalNotes,
                p_prescription_url: prescriptionUrl,
                p_medications_text: medicines,
                p_items: []
            }
        );

        // Database error
        if (error) {

            console.error("Supabase order error:", error);

            showToast(
                "حدث خطأ أثناء إرسال الطلب. يرجى المحاولة مرة أخرى.",
                "error"
            );

            return;
        }

        const orderRow = Array.isArray(orderResult) ? orderResult[0] : orderResult;
        trackingCode = orderRow.tracking_code;
        const modalDeliveryFee = Number(orderRow.delivery_fee);

        // SUCCESS
        console.log(
            "Order successfully created:",
            trackingCode
        );

        // Close prescription modal
        closePrescriptionModal();

        // Fill success modal
        document.getElementById(
            "successTrackingNumber"
        ).textContent = trackingCode;

        document.getElementById(
            "successPatientName"
        ).textContent = name;

        document.getElementById(
            "successPhone"
        ).textContent = phone;

        document.getElementById(
            "successDeliveryType"
        ).textContent = deliveryDescription;

        // Set estimated delivery time
        const estimatedTimeEl = document.getElementById("successEstimatedTime");
        if (estimatedTimeEl && DELIVERY_ESTIMATED_TIME) {
            estimatedTimeEl.textContent = `خلال ${DELIVERY_ESTIMATED_TIME}`;
        }

        // Set subtotal, delivery fee & total breakdown in success modal
        const subtotalRow = document.getElementById("successSubtotalRow");
        const subtotalEl = document.getElementById("successSubtotal");
        const deliveryFeeRowEl = document.getElementById("successDeliveryFeeRow");
        const deliveryFeeEl = document.getElementById("successDeliveryFee");
        const totalRow = document.getElementById("successTotalRow");
        const totalEl = document.getElementById("successOrderTotal");

        if (subtotalRow && subtotalEl) {
            subtotalEl.textContent = "0.00 ج.م";
            subtotalRow.style.display = "none";
        }

        if (deliveryFeeRowEl && deliveryFeeEl) {
            if (method === "delivery") {
                deliveryFeeEl.textContent = modalDeliveryFee === 0
                    ? "0.00 ج.م (توصيل مجاني)"
                    : `${modalDeliveryFee.toFixed(2)} ج.م`;
                deliveryFeeEl.style.color = modalDeliveryFee === 0 ? "#16a34a" : "";
                deliveryFeeRowEl.style.display = "flex";
            } else {
                deliveryFeeRowEl.style.display = "none";
            }
        }

        if (totalRow && totalEl) {
            totalEl.textContent = `${modalDeliveryFee.toFixed(2)} ج.م`;
            totalRow.style.display = "flex";
        }

        // Show success modal
        const successModal =
            document.getElementById("orderSuccessModal");

        if (successModal) {
            successModal.classList.add("active");
        }

        // Reset form
        event.target.reset();

        // Reset upload label
        const fileLabel =
            document.getElementById("modalRxFileLabel");

        if (fileLabel) {
            fileLabel.textContent =
                "اضغط هنا لرفع صورة الروشتة أو اسحب الملف";

            fileLabel.style.color = "";
        }

        // Reset GPS
        const locationStatus =
            document.getElementById("modalLocationStatus");

        if (locationStatus) {
            locationStatus.textContent = "";
            locationStatus.className =
                "location-status-badge";
        }

        const gpsInput =
            document.getElementById("modalGpsCoordinates");

        if (gpsInput) {
            gpsInput.value = "";
        }

        toggleModalDeliveryLocation(true);

    } catch (error) {

        console.error(
            "Unexpected order error:",
            error
        );

        showToast(
            "حدث خطأ غير متوقع أثناء إرسال الطلب.",
            "error"
        );

    } finally {

        if (submitButton) {

            submitButton.disabled = false;

            submitButton.innerHTML = `
                <i class="fa-solid fa-paper-plane"></i>
                إرسال الطلب فوراً
            `;
        }
    }
}

function closeSuccessModal() {
    const successModal = document.getElementById("orderSuccessModal");
    if (successModal) successModal.classList.remove("active");
}

// --------------------------------------------------------------------------
// 10. Medical Consultations & Clinic Booking Logic
// --------------------------------------------------------------------------
// DOCTORS_DATA is now fetched live from Supabase (table: "doctors", joined
// with "clinic_branches") instead of being hardcoded. Any doctor added, edited, or
// deactivated (is_active) in Supabase appears here automatically on the
// next page load — see loadDoctorsDirectory() below.
let DOCTORS_DATA = [];

// LIVE_CLINIC_BRANCHES holds the clinic-only branches (table:
// "clinic_branches"). Kept completely separate from LIVE_BRANCHES (the
// pharmacy branches table) so the clinic booking form never mixes the two.
let LIVE_CLINIC_BRANCHES = [];

/**
 * Fetches active clinic branches from Supabase's "clinic_branches" table.
 * Feeds only the clinic booking dropdown — every other section of the
 * site (delivery, pickup, branch locator, map) keeps using the pharmacy
 * "branches" table via loadLiveBranches(), untouched.
 */
async function loadClinicBranches(keepOnError = false) {
    try {
        const { data, error } = await supabaseClient
            .from("clinic_branches")
            .select("id, name_ar, city, address, phone, is_active")
            .eq("is_active", true)
            .order("name_ar");

        if (error) throw error;

        LIVE_CLINIC_BRANCHES = data || [];
        return true;
    } catch (err) {
        console.error("Failed to load clinic branches:", err);
        // On a background refresh keep what is already on screen.
        if (!keepOnError) LIVE_CLINIC_BRANCHES = [];
        return false;
    }
}

/**
 * Fetches active doctors from Supabase (joined with their clinic branch
 * name from "clinic_branches" — NOT the pharmacy "branches" table),
 * normalizes them into the shape the booking widget expects, then renders
 * the doctors grid and pre-fills the booking form with the first branch
 * that actually has doctors.
 */
async function loadDoctorsDirectory(preserveSelection = false) {
    // On a live refresh remember what the visitor already picked in the booking
    // form (branch / doctor / day) so it isn't reset under their hands.
    const prev = preserveSelection ? {
        doctorId: document.getElementById("clinicDocSelect")?.value || "",
        day: document.getElementById("selectedDayInput")?.value || ""
    } : null;

    try {
        const { data, error } = await supabaseClient
            .from("doctors")
            .select("*, clinic_branches(id, name_ar)")
            .eq("is_active", true)
            .order("created_at", { ascending: true });

        if (error) throw error;

        // Everything below is edited from the Dr. Mostafa Fathy Hamed Clinics dashboard
        // (Doctors page) and read here from the same "doctors" row.
        const mapped = (data || []).map(d => ({
            id: d.id,
            name: d.name_ar,
            specialty: d.specialty || "",
            // Short bio written in the dashboard; "title" is the older field.
            title: d.bio || d.title || "",
            branchId: d.branch_id,
            branchName: d.clinic_branches ? d.clinic_branches.name_ar : "",
            // New-visit fee (falls back to the legacy "fee" column) + follow-up fee.
            fee: Number(d.new_visit_fee) > 0 ? Number(d.new_visit_fee) : (Number(d.fee) || 0),
            followupFee: Number(d.followup_fee) || 0,
            avatarUrl: d.avatar_url || "",
            avatarIcon: d.avatar_icon || "fa-user-doctor",
            // Just the day names (e.g. "السبت"), no times, per the site's
            // customer-facing booking flow.
            availableDays: Array.isArray(d.available_days) ? d.available_days : []
        }));

        // Live refresh with nothing new: don't touch the page at all.
        if (preserveSelection && JSON.stringify(mapped) === JSON.stringify(DOCTORS_DATA)) return;
        DOCTORS_DATA = mapped;

        renderDoctorsGrid();

        if (DOCTORS_DATA.length > 0) {
            const branchSelect = document.getElementById("clinicBranchInput");
            const keep = prev && prev.doctorId ? DOCTORS_DATA.find(d => d.id === prev.doctorId) : null;

            if (keep) {
                // Keep the visitor's doctor (and chosen day if it still exists)
                if (branchSelect) branchSelect.value = keep.branchId;
                populateDoctorOptionsForBranch(keep.branchId, keep.id);
                if (prev.day) {
                    const dayBtn = Array.from(document.querySelectorAll("#interactiveDaySlotsContainer .time-slot-btn"))
                        .find(b => b.textContent.trim() === prev.day);
                    if (dayBtn) selectDaySlot(prev.day, dayBtn);
                }
            } else {
                // Pre-fill the booking form with the first branch that has doctors
                const defaultBranchId = DOCTORS_DATA[0].branchId;
                if (branchSelect) branchSelect.value = defaultBranchId;
                populateDoctorOptionsForBranch(defaultBranchId, DOCTORS_DATA[0].id);
            }
        } else {
            renderInteractiveDaySlots([]);
        }
    } catch (err) {
        console.error("Load doctors directory error:", err);
        if (preserveSelection) return; // background refresh: keep the current cards
        const grid = document.getElementById("doctorsGrid");
        if (grid) {
            grid.innerHTML = `
                <div style="text-align:center; padding:2rem 1rem; color:#EF4444;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size:1.5rem; margin-bottom:0.5rem;"></i>
                    <p>تعذر تحميل قائمة الأطباء حالياً. برجاء تحديث الصفحة أو المحاولة لاحقاً.</p>
                </div>
            `;
        }
    }
}

/**
 * Renders one card per active doctor into #doctorsGrid, showing only the
 * available DAYS (no times) per the customer-site requirement.
 */
function renderDoctorsGrid() {
    const grid = document.getElementById("doctorsGrid");
    if (!grid) return;

    if (DOCTORS_DATA.length === 0) {
        grid.innerHTML = `<p style="color: var(--text-muted); padding: 1rem;">لا يوجد أطباء متاحون حالياً.</p>`;
        return;
    }

    grid.innerHTML = DOCTORS_DATA.map(doc => {
        const daysHtml = doc.availableDays.map(day => `
            <span class="slot-pill"><i class="fa-solid fa-calendar-day"></i> ${escHtml(day)}</span>
        `).join("");

        // Profile picture uploaded from the clinics dashboard (icon as fallback)
        const avatarInner = doc.avatarUrl
            ? `<img src="${escHtml(doc.avatarUrl)}" alt="${escHtml(doc.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`
            : `<i class="fa-solid ${escHtml(doc.avatarIcon)}"></i>`;

        const followupHtml = doc.followupFee > 0
            ? `<span style="margin-top:0.3rem;">إعادة الكشف: <strong style="font-size:0.95rem;">${doc.followupFee.toFixed(0)} ج.م</strong></span>`
            : "";

        return `
            <div class="doctor-card">
                <div class="doctor-card-top">
                    <div class="doctor-avatar" style="overflow:hidden;">
                        ${avatarInner}
                    </div>
                    <div class="doctor-meta">
                        <span class="doc-specialty-badge">${escHtml(doc.specialty)}</span>
                        <h4 class="doc-name">${escHtml(doc.name)}</h4>
                        <p class="doc-title">${escHtml(doc.title)}</p>
                        <span class="doc-branch"><i class="fa-solid fa-location-dot"></i> ${escHtml(doc.branchName) || "غير محدد"}</span>
                    </div>
                </div>
                <div class="doctor-schedule-box">
                    <h5><i class="fa-solid fa-calendar-days"></i> الأيام المتاحة للكشف:</h5>
                    <div class="schedule-slots-pills">
                        ${daysHtml || '<span class="slot-pill">لم تُحدد أيام بعد</span>'}
                    </div>
                </div>
                <div class="doctor-card-footer">
                    <div class="doc-fee">
                        <span>قيمة الكشف:</span>
                        <strong>${doc.fee.toFixed(0)} ج.م</strong>
                        ${followupHtml}
                    </div>
                    <button type="button" class="btn btn-primary btn-sm" onclick="selectDoctorForBooking('${escHtml(doc.id)}')">
                        <i class="fa-solid fa-calendar-check"></i> احجز هذا الموعد
                    </button>
                </div>
            </div>
        `;
    }).join("");
}

/** Escapes text coming from the database before it goes into innerHTML. */
function escHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Re-reads clinic branches + doctors and updates the cards without resetting
 * what the visitor already chose in the booking form.
 */
async function refreshDoctorsLive() {
    try {
        const branchSelect = document.getElementById("clinicBranchInput");
        const prevBranch = branchSelect ? branchSelect.value : "";

        const ok = await loadClinicBranches(true);
        if (ok) {
            populateClinicBranchOptions();
            if (branchSelect && prevBranch && Array.from(branchSelect.options).some(o => o.value === prevBranch)) {
                branchSelect.value = prevBranch;
            }
        }
        await loadDoctorsDirectory(true);
    } catch (e) {
        console.warn("Live doctors refresh failed:", e);
    }
}

/**
 * Anything changed in the clinics dashboard (doctor photo, bio, fees, days,
 * activate/deactivate, branch name...) shows up here without a page reload:
 * Supabase Realtime pushes the change, plus a light safety-net refresh
 * (realtime can't announce a row that just became hidden by RLS, e.g. a
 * doctor who was deactivated).
 */
function setupRealtimeDoctors() {
    let timer = null;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(refreshDoctorsLive, 400);
    };

    try {
        supabaseClient
            .channel("realtime-clinic-doctors-sync")
            .on("postgres_changes", { event: "*", schema: "public", table: "doctors" }, schedule)
            .on("postgres_changes", { event: "*", schema: "public", table: "clinic_branches" }, schedule)
            .subscribe();
    } catch (e) {
        console.warn("Could not subscribe to doctors realtime changes:", e);
    }

    setInterval(() => { if (!document.hidden) refreshDoctorsLive(); }, 120000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshDoctorsLive(); });
}

function switchConsultationMode(mode) {
    const clinicView = document.getElementById("clinicBookingView");
    const remoteView = document.getElementById("remoteBookingView");
    const tabBtnClinic = document.getElementById("tabBtnClinic");
    const tabBtnRemote = document.getElementById("tabBtnRemote");

    if (mode === "clinic") {
        if (clinicView) clinicView.style.display = "block";
        if (remoteView) remoteView.style.display = "none";
        if (tabBtnClinic) tabBtnClinic.classList.add("active");
        if (tabBtnRemote) tabBtnRemote.classList.remove("active");
    } else {
        if (clinicView) clinicView.style.display = "none";
        if (remoteView) remoteView.style.display = "block";
        if (tabBtnClinic) tabBtnClinic.classList.remove("active");
        if (tabBtnRemote) tabBtnRemote.classList.add("active");
    }
}

function selectDoctorForBooking(doctorId) {
    // Switch to clinic view if not already
    switchConsultationMode("clinic");

    const docObj = DOCTORS_DATA.find(d => d.id === doctorId);
    if (!docObj) return;

    const branchSelect = document.getElementById("clinicBranchInput");
    if (branchSelect) branchSelect.value = docObj.branchId;

    populateDoctorOptionsForBranch(docObj.branchId, doctorId);

    // Scroll to form smoothly
    const formCard = document.getElementById("clinicBookingFormCard");
    if (formCard) {
        formCard.scrollIntoView({ behavior: "smooth" });
    }

    showToast(`تم اختيار ${docObj.name} - يرجى تحديد اليوم المناسب وتأكيد الحجز`, "info");
}

// Populates the clinic branch dropdown from the live Supabase
// "clinic_branches" table (LIVE_CLINIC_BRANCHES, loaded by
// loadClinicBranches()) — a table dedicated to clinic branches so it
// never gets mixed up with the pharmacy "branches" table used everywhere
// else on the site (delivery, pickup, branch locator, map...).
function populateClinicBranchOptions() {
    const branchSelect = document.getElementById("clinicBranchInput");
    if (!branchSelect) return;

    if (LIVE_CLINIC_BRANCHES.length === 0) {
        branchSelect.innerHTML = `<option value="" disabled selected>لا توجد فروع عيادات متاحة حالياً</option>`;
        return;
    }

    branchSelect.innerHTML = LIVE_CLINIC_BRANCHES.map(b => `
        <option value="${escHtml(b.id)}">${escHtml(b.name_ar)}</option>
    `).join("");
}

// Fills the doctor dropdown with only the doctors who work at the given
// branch (matched by branch_id), and auto-selects one (preferring
// `preferredDoctorId` if it's actually available there), then renders
// that doctor's available days.
function populateDoctorOptionsForBranch(branchId, preferredDoctorId) {
    const docSelect = document.getElementById("clinicDocSelect");
    if (!docSelect) return;

    const doctorsInBranch = DOCTORS_DATA.filter(d => d.branchId === branchId);

    if (doctorsInBranch.length === 0) {
        docSelect.innerHTML = `<option value="">لا يوجد أطباء متاحون في هذا الفرع حالياً</option>`;
        renderInteractiveDaySlots([]);
        return;
    }

    docSelect.innerHTML = doctorsInBranch.map(d => `
        <option value="${escHtml(d.id)}">${escHtml(d.name)} (${escHtml(d.specialty)})</option>
    `).join("");

    const docToSelect = doctorsInBranch.find(d => d.id === preferredDoctorId) || doctorsInBranch[0];
    docSelect.value = docToSelect.id;
    renderInteractiveDaySlots(docToSelect.availableDays);
}

// Called when the user manually picks a different branch: narrows the
// doctor list down to that branch's doctors.
function onBranchSelectChange(branchId) {
    populateDoctorOptionsForBranch(branchId);
}

function onDoctorSelectChange(doctorId) {
    const docObj = DOCTORS_DATA.find(d => d.id === doctorId);
    const branchSelect = document.getElementById("clinicBranchInput");

    if (docObj) {
        if (branchSelect) branchSelect.value = docObj.branchId;
        populateDoctorOptionsForBranch(docObj.branchId, doctorId);
    }
}

// Renders the available-DAYS picker (no times), per the site's customer-
// facing requirement — the actual visit time gets coordinated by phone.
function renderInteractiveDaySlots(days) {
    const container = document.getElementById("interactiveDaySlotsContainer");
    const inputHidden = document.getElementById("selectedDayInput");
    if (!container) return;

    if (!days || days.length === 0) {
        container.innerHTML = `<p class="text-muted">لا توجد أيام متاحة حالياً لهذا الطبيب.</p>`;
        if (inputHidden) inputHidden.value = "";
        return;
    }

    container.innerHTML = days.map((day, index) => {
        const isFirst = index === 0 ? "selected" : "";
        return `
            <button type="button" class="time-slot-btn ${isFirst}" onclick="selectDaySlot('${day}', this)">
                <i class="fa-solid fa-calendar-day"></i>
                <span>${day}</span>
            </button>
        `;
    }).join("");

    // Set first day as default value
    if (inputHidden) {
        inputHidden.value = days[0];
    }
}

function selectDaySlot(dayText, btnElement) {
    const allSlotBtns = document.querySelectorAll(".time-slot-btn");
    allSlotBtns.forEach(btn => btn.classList.remove("selected"));

    if (btnElement) {
        btnElement.classList.add("selected");
    }

    const inputHidden = document.getElementById("selectedDayInput");
    if (inputHidden) {
        inputHidden.value = dayText;
    }
}

function handleClinicAppointmentSubmit(event) {
    event.preventDefault();

    const doctorId = document.getElementById("clinicDocSelect").value;
    const branchId = document.getElementById("clinicBranchInput").value;
    const day = document.getElementById("selectedDayInput").value;
    const patientName = document.getElementById("clinicPatientName").value;
    const patientPhone = document.getElementById("clinicPatientPhone").value;
    const notes = document.getElementById("clinicNotes").value;

    const phoneRegex = /^01[0125][0-9]{8}$/;
    if (!phoneRegex.test(patientPhone)) {
        showToast("يرجى إدخال رقم هاتف محمول مصري صحيح (11 رقماً يبدأ بـ 010 أو 011 أو 012 أو 015)", "error");
        return;
    }

    if (!day) {
        showToast("يرجى اختيار اليوم المتاح المناسب لك", "error");
        return;
    }

    const docObj = DOCTORS_DATA.find(d => d.id === doctorId);
    const branchObj = LIVE_CLINIC_BRANCHES.find(b => b.id === branchId);
    const doctorName = docObj ? docObj.name : "";
    const branchName = branchObj ? branchObj.name_ar : "";

    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري إرسال طلب الحجز...';
    }

    // Send the appointment request straight to Supabase (table:
    // "clinic_appointments") so it shows up for staff immediately.
    supabaseClient
        .from("clinic_appointments")
        .insert({
            doctor_id: doctorId || null,
            doctor_name: doctorName,
            branch_id: branchId || null,
            branch_name: branchName,
            preferred_day: day,
            patient_name: patientName,
            patient_phone: patientPhone,
            notes: notes,
            status: "new"
        })
        .then(({ error }) => {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-ticket"></i> تأكيد حجز كشف العيادة واستلام التذكرة';
            }

            if (error) {
                console.error("Clinic appointment insert error:", error);
                showToast("عذراً، حدث خطأ أثناء إرسال طلب الحجز. يرجى المحاولة لاحقاً.", "error");
                return;
            }

            const ticketCode = "CLN-EGY-" + Math.floor(1000 + Math.random() * 9000);

            // Populate modal ticket
            document.getElementById("ticketNumber").textContent = ticketCode;
            document.getElementById("ticketDoctorName").textContent = doctorName;
            // This row is labelled "التخصص" (specialty), so show the chosen
            // doctor's specialty. It used to show the branch name here, which
            // contradicted the label.
            document.getElementById("ticketSpecialty").textContent =
                (docObj && docObj.specialty) ? docObj.specialty : "-";
            document.getElementById("ticketPreferredDay").textContent = day;
            document.getElementById("ticketPatientName").textContent = patientName;
            document.getElementById("ticketPhone").textContent = patientPhone;

            // Show modal
            const ticketModal = document.getElementById("clinicTicketModal");
            if (ticketModal) {
                ticketModal.classList.add("active");
            }

            event.target.reset();
            onDoctorSelectChange(doctorId);
        });
}

function closeClinicTicketModal() {
    const ticketModal = document.getElementById("clinicTicketModal");
    if (ticketModal) {
        ticketModal.classList.remove("active");
    }
}

function selectConsultationType(typeName) {
    switchConsultationMode("remote");
    const select = document.getElementById("consType");
    if (select) {
        select.value = typeName;
    }
    const formCard = document.querySelector(".consultation-form-card");
    if (formCard) {
        formCard.scrollIntoView({ behavior: "smooth" });
    }
}

function handleConsultationSubmit(event) {
    event.preventDefault();

    const name = document.getElementById("consName").value;
    const phone = document.getElementById("consPhone").value;
    const type = document.getElementById("consType").value;
    const time = document.getElementById("consTime").value;
    const details = document.getElementById("consDetails").value;
    const contactMethod = (document.querySelector('input[name="commChannel"]:checked') || {}).value || "phone";

    const phoneRegex = /^01[0125][0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
        showToast("يرجى إدخال رقم هاتف مصري صحيح (11 رقماً)", "error");
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري إرسال طلب الاستشارة...';
    }

    supabaseClient
        .from("consultations")
        .insert({
            patient_name: name,
            phone: phone,
            consultation_type: type,
            preferred_time: time,
            contact_method: contactMethod,
            details: details,
            status: "new"
        })
        .then(({ error }) => {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-calendar-check"></i> تأكيد حجز الاستشارة الطبية المجانية';
            }

            if (error) {
                console.error("Consultation insert error:", error);
                showToast("عذراً، حدث خطأ أثناء إرسال طلب الاستشارة. يرجى المحاولة لاحقاً.", "error");
                return;
            }

            showToast(`تم حجز استشارتك الطبية بنجاح يا ${name}! سيتواصل معك الصيدلي الاستشاري في ${time}.`, "success");
            event.target.reset();
        });
}

// --------------------------------------------------------------------------
// 11. Branch Locator & Contact Us Logic
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// 11b. Live Branches Section (Supabase-backed: "فروع صيدلية د.مصطفى فتحي حامد" +
//      "شبكة التوزيع والفروع"). Any branch added/edited/deactivated in
//      the `branches` table is reflected here automatically on page load.
//      Kept separate from BRANCHES_DATA (used only by the clinic booking
//      widget) so this never affects that feature.
// --------------------------------------------------------------------------
let LIVE_BRANCHES = [];

const CITY_NAME_AR = {
    cairo: "القاهرة",
    giza: "الجيزة",
    alexandria: "الإسكندرية",
    dakahlia: "الدقهلية",
    mansoura: "المنصورة"
};

function formatCityName(rawCity) {
    if (!rawCity) return "عام";
    const lower = String(rawCity).trim().toLowerCase();
    return CITY_NAME_AR[lower] || rawCity.trim();
}

async function loadLiveBranches() {
    try {
        const { data, error } = await supabaseClient
            .from("branches")
            .select("id, name_ar, city, address, phone, hours, manager, is_active")
            .eq("is_active", true)
            .order("city")
            .order("name_ar");

        if (error) throw error;

        LIVE_BRANCHES = data || [];
        renderBranchTabs();
        renderDistributionMap();
        populatePickupBranchSelects();
    } catch (err) {
        console.error("Failed to load branches:", err);
    }
}

function renderBranchTabs() {
    const tabsContainer = document.getElementById("branchTabs");
    if (!tabsContainer) return;

    const cities = [...new Set(LIVE_BRANCHES.map(b => formatCityName(b.city)).filter(Boolean))];

    if (cities.length === 0) {
        tabsContainer.innerHTML = "";
        const branchesContainer = document.getElementById("branchesList");
        if (branchesContainer) {
            branchesContainer.innerHTML = `<p style="color: var(--text-muted);">لا توجد فروع مضافة حالياً.</p>`;
        }
        return;
    }

    tabsContainer.innerHTML = "";
    cities.forEach((city, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "branch-tab-btn" + (index === 0 ? " active" : "");
        btn.setAttribute("data-city", city);
        btn.textContent = `فروع ${city}`;
        btn.addEventListener("click", () => renderBranchesForCity(city));
        tabsContainer.appendChild(btn);
    });

    renderBranchesForCity(cities[0]);
}

function renderBranchesForCity(city) {
    const branchesContainer = document.getElementById("branchesList");
    const buttons = document.querySelectorAll("#branchTabs .branch-tab-btn");

    buttons.forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-city") === city || btn.textContent === `فروع ${city}`);
    });

    const branches = LIVE_BRANCHES.filter(b => formatCityName(b.city) === city);

    if (!branchesContainer) return;

    if (branches.length === 0) {
        branchesContainer.innerHTML = `<p style="color: var(--text-muted);">لا توجد فروع مسجلة في ${escHtml(city)} حالياً.</p>`;
        return;
    }

    branchesContainer.innerHTML = branches.map(b => `
        <div class="branch-item-card">
            <h4>
                <i class="fa-solid fa-hospital" style="color: var(--primary); margin-left: 0.4rem;"></i> ${escHtml(b.name_ar)}
                <span class="branch-gov-badge" style="background: rgba(16, 185, 129, 0.12); color: var(--primary); font-size: 0.78rem; padding: 2px 8px; border-radius: 6px; font-weight: 600; margin-right: 0.5rem;"><i class="fa-solid fa-location-dot"></i> ${escHtml(formatCityName(b.city))}</span>
            </h4>
            <p><i class="fa-solid fa-location-dot" style="color: var(--text-muted); margin-left: 0.4rem;"></i> <strong>العنوان:</strong> ${escHtml(b.address || "غير محدد")}</p>
            <p><i class="fa-solid fa-phone" style="color: var(--text-muted); margin-left: 0.4rem;"></i> <strong>التليفون:</strong> ${escHtml(b.phone || "غير محدد")} | <a href="tel:${escHtml(String(b.phone || "").replace(/[^+0-9]/g, ""))}" style="color: var(--primary); font-weight: bold;">اتصال مباشر</a></p>
            <p><i class="fa-solid fa-clock" style="color: var(--text-muted); margin-left: 0.4rem;"></i> <strong>المواعيد:</strong> ${escHtml(b.hours || "يومياً من ٨:٠٠ ص إلى ٤:٠٠ فجر")}</p>
            <p><i class="fa-solid fa-user-doctor" style="color: var(--text-muted); margin-left: 0.4rem;"></i> <strong>مدير الفرع:</strong> ${escHtml(b.manager || "غير محدد")}</p>
        </div>
    `).join("");
}

function populatePickupBranchSelects() {
    const selects = [
        document.getElementById("orderBranch"),
        document.getElementById("modalBranchSelect")
    ].filter(Boolean);

    if (selects.length === 0) return;

    const optionsHtml = LIVE_BRANCHES
        .map(b => `<option value="${escHtml(b.id)}">${escHtml(b.name_ar)} (${escHtml(formatCityName(b.city))})</option>`)
        .join("");

    selects.forEach(select => {
        select.innerHTML = optionsHtml || `<option value="" disabled selected>لا توجد فروع متاحة حالياً</option>`;
    });
}

function renderDistributionMap() {
    const mapContainer = document.getElementById("mapVisualPlaceholder");
    if (!mapContainer) return;

    if (LIVE_BRANCHES.length === 0) {
        mapContainer.innerHTML = `<div class="map-overlay-text"><p>لا توجد فروع مضافة حالياً</p></div>`;
        return;
    }

    // Simple auto-generated grid layout for pins (3 per row) so any number
    // of branches from Supabase gets placed without manual positioning.
    const cols = 3;
    const pinsHtml = LIVE_BRANCHES.map((b, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const top = `${20 + row * 32}%`;
        const right = `${15 + col * 30}%`;
        return `
            <div class="map-pin pin-mansoura" style="top: ${top}; right: ${right};" title="${escHtml(b.name_ar)}">
                <i class="fa-solid fa-hospital"></i>
                <span>${escHtml(b.name_ar)} (${escHtml(formatCityName(b.city))})</span>
            </div>
        `;
    }).join("");

    const cities = [...new Set(LIVE_BRANCHES.map(b => formatCityName(b.city)))].join(" و");

    mapContainer.innerHTML = pinsHtml + `
        <div class="map-overlay-text">
            <p><i class="fa-solid fa-truck-fast"></i> خدمة توصيل تغطي ${escHtml(cities)} والمناطق المجاورة</p>
        </div>
    `;
}

function handleContactSubmit(event) {
    event.preventDefault();

    const name = document.getElementById("contactName").value;
    const phone = document.getElementById("contactPhone").value;

    const phoneRegex = /^01[0125][0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
        showToast("يرجى إدخال رقم هاتف مصري صحيح (11 رقماً)", "error");
        return;
    }

    showToast(`شكراً لتواصلك يا ${name}. تم استلام رسالتك وسيتم الرد عليك في أقرب وقت.`, "success");
    event.target.reset();
}

// --------------------------------------------------------------------------
// 12. Toast Notification Helper
// --------------------------------------------------------------------------
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icon = type === "success" ? "fa-circle-check" : "fa-circle-exclamation";
    const iconEl = document.createElement("i");
    iconEl.className = `fa-solid ${icon}`;
    const messageEl = document.createElement("span");
    messageEl.textContent = String(message == null ? "" : message);
    toast.append(iconEl, messageEl);

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

// --------------------------------------------------------------------------
// 13. Hero Video (optional) — reveals only when a real file is present.
// --------------------------------------------------------------------------
(function () {
    function setupHeroVideo() {
        const heroVideo = document.getElementById("heroVideo");
        if (!heroVideo) return;

        const placeholder = document.getElementById("heroMediaPlaceholder");

        // No shipped media in this template: if nothing loaded, keep the placeholder.
        heroVideo.addEventListener("error", () => {
            heroVideo.hidden = true;
            if (placeholder) placeholder.hidden = false;
        }, { once: true });

        heroVideo.muted = true;
        heroVideo.setAttribute("muted", "");

        const reveal = () => {
            heroVideo.hidden = false;
            if (placeholder) placeholder.hidden = true;
        };

        const tryPlay = () => {
            const playPromise = heroVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // Autoplay blocked: retry on first user interaction anywhere on the page
                    const resume = () => {
                        heroVideo.play().catch(() => {});
                        document.removeEventListener("click", resume);
                        document.removeEventListener("touchstart", resume);
                    };
                    document.addEventListener("click", resume, { once: true });
                    document.addEventListener("touchstart", resume, { once: true });
                });
            }
        };

        if (heroVideo.readyState >= 2) {
            reveal();
            tryPlay();
        } else {
            heroVideo.addEventListener("loadeddata", () => {
                reveal();
                tryPlay();
            }, { once: true });
        }

        // If the browser tab was backgrounded and paused it, resume on return
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && !heroVideo.hidden && heroVideo.paused) {
                heroVideo.play().catch(() => {});
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupHeroVideo);
    } else {
        setupHeroVideo();
    }
})();
