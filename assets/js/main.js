// --- Stripe 初期化 ---
// Note: テスト用公開鍵
const stripe = Stripe('pk_test_TYooMQauvdEDq54NiTphI7jx');
const elements = stripe.elements();

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
        displayError.textContent = event.error.message;
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

// カード決済ハンドラ
function handleCardPayment() {
    setLoading(true, 'card');
    stripe.createToken(card).then(function(result) {
        if (result.error) {
            const errorElement = document.getElementById('card-errors');
            errorElement.textContent = result.error.message;
            setLoading(false, 'card');
        } else {
            stripeTokenHandler(result.token);
        }
    });
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

function stripeTokenHandler(token) {
    console.log('Received Stripe token:', token.id);
    setTimeout(() => {
        setLoading(false, 'card');
        const btn = document.getElementById('submitBtnCard');
        const btnText = document.getElementById('btnTextCard');
        
        btnText.textContent = '完了！';
        btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btn.classList.add('bg-green-500', 'hover:bg-green-600');

        setTimeout(() => {
            alert('【テスト決済成功】\n※実際の請求は発生しません。\n\nトークンが作成されました。\nご登録ありがとうございます。');
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

