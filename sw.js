/*
 * ============================================================
 * Service Worker — صيدلية د.مصطفى فتحي حامد
 * Scope  : /Dr.Mostafa-Fathy-Hamed-Website/
 * Version: pharmacy-static-v1
 * ============================================================
 *
 * استراتيجيات الكاش:
 *   ✗  supabase.co + jsdelivr.net  → Network-Only (لا يُحفَظ أبداً)
 *   ↔  Google Fonts + Font Awesome  → Network-First ثم Cache
 *   ✓  ملفات الموقع المحلية        → Cache-First (بكاش يحمل رقم إصدار)
 *
 * أمان: ردود Supabase API وبيانات الطلبات والروشتات
 *       لا تُعترض ولا تُخزَّن في الكاش إطلاقاً.
 * ============================================================
 */

'use strict';

// ── إصدار الكاش ────────────────────────────────────────────────────────────────
// غيِّر هذه القيمة مع كل نشر جديد لتفعيل التحديث
const CACHE_NAME = 'pharmacy-static-v1';

// المسار الأساسي للموقع على GitHub Pages
const BASE = '/Dr.Mostafa-Fathy-Hamed-Website';

// ── الملفات التي تُحفَظ مسبقاً عند أول تثبيت ──────────────────────────────────
const PRECACHE_URLS = [
    BASE + '/',
    BASE + '/index.html',
    BASE + '/style.css',
    BASE + '/script.js',
    BASE + '/assets/pharmacy-logo.jpg',
    BASE + '/assets/icon-512.jpg',
];

// ── نطاقات تعمل بـ Network-Only دائماً (لا كاش إطلاقاً) ──────────────────────
// يشمل هذا جميع طلبات Supabase API, Storage, Realtime, Auth
const BYPASS_HOSTNAMES = new Set([
    'xuctfoiwzflevnfwfqcv.supabase.co',
    'cdn.jsdelivr.net',        // مكتبة Supabase JS SDK
]);

// ── نطاقات تعمل بـ Network-First ثم Cache (خطوط وأيقونات) ────────────────────
const NETWORK_FIRST_HOSTNAMES = new Set([
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',    // Font Awesome
]);


// =============================================================================
// حدث Install — تحميل الملفات الأساسية
// =============================================================================
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(PRECACHE_URLS);
        })
    );
    // لا نستدعي skipWaiting() هنا —
    // التحديث يتم فقط بعد موافقة المستخدم عبر زر "تحديث الآن"
});


// =============================================================================
// حدث Activate — حذف الكاشات القديمة بأمان
// =============================================================================
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (allKeys) {
            return Promise.all(
                allKeys
                    // احذف فقط الكاشات التي تبدأ بـ pharmacy- وليست الإصدار الحالي
                    .filter(function (key) {
                        return key.startsWith('pharmacy-') && key !== CACHE_NAME;
                    })
                    .map(function (key) {
                        return caches.delete(key);
                    })
            );
        }).then(function () {
            // السيطرة الفورية على جميع صفحات النطاق
            return self.clients.claim();
        })
    );
});


// =============================================================================
// حدث Message — استقبال أمر SKIP_WAITING من إشعار التحديث
// =============================================================================
self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});


// =============================================================================
// حدث Fetch — التحكم في كل الطلبات
// =============================================================================
self.addEventListener('fetch', function (event) {
    var request = event.request;
    var url;

    // 1. تجاهل طلبات غير GET (POST, PUT, PATCH, DELETE ...)
    if (request.method !== 'GET') return;

    try {
        url = new URL(request.url);
    } catch (_) {
        return;
    }

    // 2. تجاهل المخططات غير HTTP مثل chrome-extension, data ...
    if (!url.protocol.startsWith('http')) return;

    // 3. Network-Only: Supabase و jsDelivr — لا يُحفَظ أي شيء
    if (BYPASS_HOSTNAMES.has(url.hostname)) {
        event.respondWith(fetchNetworkOnly(request));
        return;
    }

    // 4. Network-First: الخطوط وFont Awesome
    if (NETWORK_FIRST_HOSTNAMES.has(url.hostname)) {
        event.respondWith(fetchNetworkFirst(request));
        return;
    }

    // 5. ملفات الموقع المحلية: Cache-First
    if (url.origin === self.location.origin) {
        event.respondWith(fetchCacheFirst(request));
        return;
    }

    // 6. أي طلب آخر: يمر مباشرة للشبكة
    event.respondWith(fetchNetworkOnly(request));
});


// =============================================================================
// استراتيجية Network-Only
// =============================================================================
function fetchNetworkOnly(request) {
    return fetch(request).catch(function () {
        return new Response('', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    });
}


// =============================================================================
// استراتيجية Network-First (مع fallback من الكاش)
// =============================================================================
function fetchNetworkFirst(request) {
    return fetch(request).then(function (response) {
        if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
                cache.put(request, clone);
            });
        }
        return response;
    }).catch(function () {
        return caches.match(request).then(function (cached) {
            return cached || new Response('', {
                status: 503,
                statusText: 'Service Unavailable'
            });
        });
    });
}


// =============================================================================
// استراتيجية Cache-First (مع fallback من الشبكة)
// قواعد مهمة:
//  - نُطبِّع الـ URL بحذف query string قبل البحث في الكاش
//    (يتعامل مع style.css?v=20261020-1 وما شابهها)
//  - إذا لم نجد في الكاش، نجلب من الشبكة ونحفظ للمرة القادمة
//  - إذا فشلت الشبكة وكنا نطلب صفحة HTML، نُرجع index.html كـ fallback
// =============================================================================
function fetchCacheFirst(request) {
    var cacheKey = normalizeCacheKey(request);

    return caches.match(cacheKey).then(function (cached) {
        if (cached) return cached;

        return fetch(request).then(function (response) {
            if (response.ok) {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(cacheKey, clone);
                });
            }
            return response;
        }).catch(function () {
            // إذا فشلت الشبكة ونطلب صفحة HTML — أرجع هيكل الموقع من الكاش
            if (request.destination === 'document') {
                return caches.match(BASE + '/index.html').then(function (fallback) {
                    return fallback || new Response(
                        '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
                        '<title>غير متصل بالإنترنت</title></head><body style="font-family:Cairo,sans-serif;' +
                        'text-align:center;padding:3rem;direction:rtl">' +
                        '<h2>⚠️ لا يوجد اتصال بالإنترنت</h2>' +
                        '<p>يرجى التحقق من الاتصال بالإنترنت وإعادة المحاولة.</p>' +
                        '<button onclick="location.reload()" style="padding:.75rem 2rem;' +
                        'background:#5A3825;color:#fff;border:none;border-radius:.5rem;' +
                        'font-size:1rem;cursor:pointer;font-family:Cairo,sans-serif">إعادة المحاولة</button>' +
                        '</body></html>',
                        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                    );
                });
            }
            return new Response('', { status: 503, statusText: 'Service Unavailable' });
        });
    });
}


// =============================================================================
// مساعد: تطبيع الـ URL بحذف query string لتوحيد مفتاح الكاش
// =============================================================================
function normalizeCacheKey(request) {
    var url = new URL(request.url);
    if (url.search) {
        url.search = '';
        return new Request(url.toString(), {
            method: request.method,
            headers: request.headers,
            mode: request.mode === 'navigate' ? 'same-origin' : request.mode,
            credentials: request.credentials,
            redirect: request.redirect
        });
    }
    return request;
}
