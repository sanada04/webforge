// --- Stripe 初期化 ---
// 本番環境用公開鍵
const stripe = Stripe('pk_live_51Sb0h9RqJVOTVojFVw8l2xY950buv1KYy7uCGnuEq27JhsLTdxSSSmDB57dKprjn3ONztAu32X7aD6lM9CRHoDX9000LGLnCVS');
const elements = stripe.elements();

// --- セキュリティ対策: 試行回数制限の管理 ---
const SECURITY_CONFIG = {
    MAX_ATTEMPTS_PER_EMAIL: 5,        // 同一メールアドレスからの最大試行回数
    MAX_ATTEMPTS_PER_SESSION: 10,     // セッションあたりの最大試行回数
    LOCKOUT_DURATION: 60 * 60 * 1000, // ロックアウト時間（1時間）
    RESET_WINDOW: 24 * 60 * 60 * 1000 // リセットウィンドウ（24時間）
};

// ローカルストレージから試行回数を取得
function getAttemptData() {
    const stored = localStorage.getItem('stripe_attempts');
    if (!stored) return { emailAttempts: {}, sessionAttempts: 0, lastReset: Date.now() };
    
    try {
        const data = JSON.parse(stored);
        // 24時間経過したらリセット
        if (Date.now() - data.lastReset > SECURITY_CONFIG.RESET_WINDOW) {
            return { emailAttempts: {}, sessionAttempts: 0, lastReset: Date.now() };
        }
        return data;
    } catch {
        return { emailAttempts: {}, sessionAttempts: 0, lastReset: Date.now() };
    }
}

// 試行回数を保存
function saveAttemptData(data) {
    localStorage.setItem('stripe_attempts', JSON.stringify(data));
}

// 試行回数をチェック
function checkAttemptLimit(email) {
    const data = getAttemptData();
    const emailLower = email ? email.toLowerCase().trim() : '';
    
    // セッション全体の試行回数チェック
    if (data.sessionAttempts >= SECURITY_CONFIG.MAX_ATTEMPTS_PER_SESSION) {
        return {
            allowed: false,
            message: 'セキュリティのため、しばらく時間をおいてから再度お試しください。'
        };
    }
    
    // 同一メールアドレスからの試行回数チェック
    if (emailLower && data.emailAttempts[emailLower]) {
        const emailData = data.emailAttempts[emailLower];
        
        // ロックアウト中かチェック
        if (emailData.lockedUntil && Date.now() < emailData.lockedUntil) {
            const minutesLeft = Math.ceil((emailData.lockedUntil - Date.now()) / (60 * 1000));
            return {
                allowed: false,
                message: `セキュリティのため、${minutesLeft}分後に再度お試しください。`
            };
        }
        
        // ロックアウト期間が過ぎていたらリセット
        if (emailData.lockedUntil && Date.now() >= emailData.lockedUntil) {
            emailData.count = 0;
            emailData.lockedUntil = null;
        }
        
        // 試行回数が上限に達したらロックアウト
        if (emailData.count >= SECURITY_CONFIG.MAX_ATTEMPTS_PER_EMAIL) {
            emailData.lockedUntil = Date.now() + SECURITY_CONFIG.LOCKOUT_DURATION;
            saveAttemptData(data);
            return {
                allowed: false,
                message: 'セキュリティのため、1時間後に再度お試しください。'
            };
        }
    }
    
    return { allowed: true };
}

// 試行回数を記録
function recordAttempt(email, success = false) {
    const data = getAttemptData();
    const emailLower = email ? email.toLowerCase().trim() : '';
    
    // 成功した場合は試行回数をリセット
    if (success) {
        if (emailLower && data.emailAttempts[emailLower]) {
            delete data.emailAttempts[emailLower];
        }
        data.sessionAttempts = 0;
    } else {
        // 失敗した場合は試行回数を増やす
        data.sessionAttempts++;
        
        if (emailLower) {
            if (!data.emailAttempts[emailLower]) {
                data.emailAttempts[emailLower] = { count: 0 };
            }
            data.emailAttempts[emailLower].count++;
        }
    }
    
    saveAttemptData(data);
}

// Stripe Elements のスタイル設定
const style = {
    base: {
        color: '#1e293b', // slate-800
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSmoothing: 'antialiased',
        fontSize: '16px',
        '::placeholder': {
            color: '#94a3b8' // slate-400
        }
    },
    invalid: {
        color: '#ef4444', // red-500
        iconColor: '#ef4444'
    }
};

const card = elements.create('card', { style: style, hidePostalCode: true });
card.mount('#card-element');

card.addEventListener('change', function(event) {
    const displayError = document.getElementById('card-errors');
    if (event.error) {
        // セキュリティ対策: エラー内容を非表示にして汎用的なメッセージを表示
        displayError.textContent = 'カード情報に問題があります。内容をご確認ください。';
    } else {
        displayError.textContent = '';
    }
});

// --- タブ切り替え制御 ---
let currentPaymentMethod = 'card';

function switchTab(method) {
    currentPaymentMethod = method;
    const tabCard = document.getElementById('tab-card');
    const tabPayPay = document.getElementById('tab-paypay');
    const cardFields = document.getElementById('card-fields');
    const payPayFields = document.getElementById('paypay-fields');

    if (method === 'card') {
        // Style updates
        tabCard.classList.add('border-blue-600', 'text-blue-600');
        tabCard.classList.remove('border-transparent', 'text-slate-500');
        tabPayPay.classList.remove('border-blue-600', 'text-blue-600');
        tabPayPay.classList.add('border-transparent', 'text-slate-500');
        
        // Content visibility
        cardFields.classList.remove('hidden');
        payPayFields.classList.add('hidden');
    } else {
        // Style updates
        tabPayPay.classList.add('border-[#FF0033]', 'text-[#FF0033]'); // PayPay Color
        tabPayPay.classList.remove('border-transparent', 'text-slate-500');
        tabCard.classList.remove('border-blue-600', 'text-blue-600');
        tabCard.classList.add('border-transparent', 'text-slate-500');
        
        // Content visibility
        cardFields.classList.add('hidden');
        payPayFields.classList.remove('hidden');
    }
}


// --- スムーススクロール制御 ---
document.addEventListener('DOMContentLoaded', () => {
    // 固定ヘッダーの高さを取得（h-16 = 64px）
    const headerHeight = 64;
    
    // アンカーリンクをクリックしたときの処理
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            // 空のアンカー（#のみ）やJavaScriptリンクは除外
            if (href === '#' || href === '') {
                return;
            }
            
            const targetId = href.substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                e.preventDefault();
                
                // ターゲット要素の位置を取得し、ヘッダーの高さ分を引く
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - headerHeight;
                
                // スムーススクロール
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
});

// --- アニメーション制御 ---
document.addEventListener('DOMContentLoaded', () => {
    const triggers = document.querySelectorAll('.scroll-trigger');

    triggers.forEach(el => {
        el.classList.add('js-scroll-hidden');
    });

    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.2
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const element = entry.target;
                const animationClass = element.getAttribute('data-animation') || 'animate-fade-up';
                element.classList.remove('js-scroll-hidden');
                element.classList.add(animationClass);
                observer.unobserve(element);
            }
        });
    }, observerOptions);

    triggers.forEach(trigger => {
        observer.observe(trigger);
    });
});


// --- モーダル制御 ---
const modal = document.getElementById('paymentModal');
const overlay = document.getElementById('modalOverlay');
const panel = document.getElementById('modalPanel');
let isModalOpen = false;

function openModal() {
    if (isModalOpen) return;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        panel.classList.remove('opacity-0', 'translate-y-4', 'sm:translate-y-0', 'sm:scale-95');
        panel.classList.add('opacity-100', 'translate-y-0', 'sm:scale-100');
    });
    document.body.style.overflow = 'hidden';
    isModalOpen = true;
    
    // モーダルを開いたときにエラーメッセージをクリア
    document.getElementById('card-errors').textContent = '';
}

function closeModal() {
    if (!isModalOpen) return;
    overlay.classList.add('opacity-0');
    panel.classList.remove('opacity-100', 'translate-y-0', 'sm:scale-100');
    panel.classList.add('opacity-0', 'translate-y-4', 'sm:translate-y-0', 'sm:scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        resetForm();
        isModalOpen = false;
    }, 500);
}

// --- 決済処理 (Card & PayPay) ---
const form = document.getElementById('paymentForm');

// カード決済送信
form.addEventListener('submit', function(event) {
    event.preventDefault();
    if (currentPaymentMethod === 'card') {
        handleCardPayment();
    }
});

// カード決済ハンドラ（Netlify Functions経由）
async function handleCardPayment() {
    const email = document.getElementById('email').value;
    const name = document.getElementById('name').value;
    
    // セキュリティチェック: 試行回数制限（フロントエンド側）
    const limitCheck = checkAttemptLimit(email);
    if (!limitCheck.allowed) {
        const errorElement = document.getElementById('card-errors');
        errorElement.textContent = limitCheck.message;
        return;
    }
    
    setLoading(true, 'card');
    
    // エラーメッセージをクリア
    document.getElementById('card-errors').textContent = '';
    
    try {
        // Netlify Function経由でPaymentIntentを作成
        const response = await fetch('/.netlify/functions/create-payment-intent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                amount: 49800, // ¥49,800
                currency: 'jpy',
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            // サーバー側のエラー（レート制限など）
            const errorElement = document.getElementById('card-errors');
            errorElement.textContent = data.message || '処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。';
            
            recordAttempt(email, false);
            setLoading(false, 'card');
            return;
        }

        // PaymentIntentが作成されたら、Stripeで確認を完了
        const { error: confirmError } = await stripe.confirmCardPayment(data.clientSecret, {
            payment_method: {
                card: card,
                billing_details: {
                    name: name,
                    email: email,
                },
            },
        });

        if (confirmError) {
            // セキュリティ対策: エラー内容を非表示にして汎用的なメッセージを表示
            const errorElement = document.getElementById('card-errors');
            errorElement.textContent = 'カード情報に問題があります。内容をご確認ください。';
            
            recordAttempt(email, false);
            setLoading(false, 'card');
        } else {
            // 成功した場合は試行回数をリセット
            recordAttempt(email, true);
            stripeTokenHandler({ id: data.id });
        }

    } catch (error) {
        console.error('Payment error:', error);
        // 予期しないエラーの場合も汎用的なメッセージを表示
        const errorElement = document.getElementById('card-errors');
        errorElement.textContent = '処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。';
        
        recordAttempt(email, false);
        setLoading(false, 'card');
    }
}

// PayPay決済ハンドラ (シミュレーション)
function handlePayPayPayment() {
    // バリデーション (名前とメールのみ簡易チェック)
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    
    if (!name || !email) {
        alert('お名前とメールアドレスを入力してください。');
        return;
    }

    setLoading(true, 'paypay');
    
    // 擬似的なPayPayリダイレクト処理
    setTimeout(() => {
        setLoading(false, 'paypay');
        const btn = document.getElementById('submitBtnPayPay');
        const btnText = document.getElementById('btnTextPayPay');
        
        btnText.textContent = '完了！';
        btn.classList.add('bg-green-500', 'hover:bg-green-600');

        setTimeout(() => {
            alert('【PayPay決済シミュレーション】\n\nPayPayアプリでの支払いが完了しました。\nご登録ありがとうございます！');
            closeModal();
        }, 500);
    }, 2000);
}

function stripeTokenHandler(paymentIntent) {
    console.log('Payment Intent confirmed:', paymentIntent.id);
    setTimeout(() => {
        setLoading(false, 'card');
        const btn = document.getElementById('submitBtnCard');
        const btnText = document.getElementById('btnTextCard');
        
        btnText.textContent = '完了！';
        btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btn.classList.add('bg-green-500', 'hover:bg-green-600');

        setTimeout(() => {
            alert('【決済処理が完了しました】\n\nご登録ありがとうございます。\n確認メールをお送りいたします。');
            closeModal();
            card.clear();
            document.getElementById('name').value = '';
            document.getElementById('email').value = '';
        }, 500);
    }, 1500);
}

function setLoading(isLoading, method) {
    const btn = method === 'card' ? document.getElementById('submitBtnCard') : document.getElementById('submitBtnPayPay');
    const btnText = method === 'card' ? document.getElementById('btnTextCard') : document.getElementById('btnTextPayPay');
    const btnSpinner = method === 'card' ? document.getElementById('btnSpinnerCard') : document.getElementById('btnSpinnerPayPay');
    const defaultText = method === 'card' ? '¥49,800 を支払う' : 'PayPayで支払う';

    if (isLoading) {
        btn.disabled = true;
        btnText.textContent = '処理中...';
        btnSpinner.classList.remove('hidden');
    } else {
        btn.disabled = false;
        btnText.textContent = defaultText;
        btnSpinner.classList.add('hidden');
    }
}

function resetForm() {
    // Reset Card UI
    const btnCard = document.getElementById('submitBtnCard');
    const btnTextCard = document.getElementById('btnTextCard');
    const btnSpinnerCard = document.getElementById('btnSpinnerCard');
    
    btnCard.disabled = false;
    btnTextCard.textContent = '¥49,800 を支払う';
    btnSpinnerCard.classList.add('hidden');
    btnCard.classList.add('bg-blue-600', 'hover:bg-blue-700');
    btnCard.classList.remove('bg-green-500', 'hover:bg-green-600');
    
    // Reset PayPay UI
    const btnPayPay = document.getElementById('submitBtnPayPay');
    const btnTextPayPay = document.getElementById('btnTextPayPay');
    btnPayPay.disabled = false;
    btnTextPayPay.textContent = 'PayPayで支払う';
    btnPayPay.classList.remove('bg-green-500', 'hover:bg-green-600');

    document.getElementById('card-errors').textContent = '';
    
    // Reset Tab to Card
    switchTab('card');
}

