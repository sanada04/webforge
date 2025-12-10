// --- Stripe 初期化 ---
// 環境判定: localhost または netlify.app の場合はテスト環境、それ以外は本番環境
const isDevelopment = window.location.hostname === 'localhost' || 
                      window.location.hostname.includes('netlify.app') ||
                      window.location.hostname.includes('127.0.0.1');

// 公開鍵の設定（テスト環境と本番環境で切り替え）
const STRIPE_PUBLISHABLE_KEY = isDevelopment 
    ? 'pk_test_51Sb0h9RqJVOTVojFVw8l2xY950buv1KYy7uCGnuEq27JhsLTdxSSSmDB57dKprjn3ONztAu32X7aD6lM9CRHoDX9000LGLnCVS' // テスト環境用
    : 'pk_live_51Sb0h9RqJVOTVojFVw8l2xY950buv1KYy7uCGnuEq27JhsLTdxSSSmDB57dKprjn3ONztAu32X7aD6lM9CRHoDX9000LGLnCVS'; // 本番環境用

const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
const elements = stripe.elements();

// デバッグ用: 環境情報をコンソールに出力（本番環境では削除推奨）
if (isDevelopment) {
    console.log('🔧 Stripe環境:', isDevelopment ? 'テスト環境' : '本番環境');
    console.log('🔑 使用中の公開鍵:', STRIPE_PUBLISHABLE_KEY.substring(0, 20) + '...');
}

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
    
    // テスト環境の場合はヘルパー情報を表示
    const testModeInfo = document.getElementById('test-mode-info');
    if (testModeInfo) {
        if (isDevelopment) {
            testModeInfo.classList.remove('hidden');
        } else {
            testModeInfo.classList.add('hidden');
        }
    }
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

// カード決済ハンドラ（Vercel Functions経由）
async function handleCardPayment() {
    const email = document.getElementById('email').value.trim();
    const name = document.getElementById('name').value.trim();
    
    // バリデーション
    if (!email || !name) {
        const errorElement = document.getElementById('card-errors');
        errorElement.textContent = 'お名前とメールアドレスを入力してください。';
        return;
    }
    
    // メールアドレスの形式チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        const errorElement = document.getElementById('card-errors');
        errorElement.textContent = '有効なメールアドレスを入力してください。';
        return;
    }
    
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
        // Vercel Function経由でPaymentIntentを作成
        const response = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                name: name,
                amount: 29800, // ¥29,800（先着5名様限定価格）※5名購入後は49800に変更してください
                currency: 'jpy',
            }),
        });

        // レスポンスの解析前にステータスをチェック
        if (!response.ok) {
            let errorMessage = '処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。';
            
            try {
                const errorData = await response.json();
                errorMessage = errorData.message || errorData.error || errorMessage;
            } catch (e) {
                // JSON解析に失敗した場合、ステータスコードから判断
                if (response.status === 429) {
                    errorMessage = 'リクエストが多すぎます。しばらく時間をおいてから再度お試しください。';
                } else if (response.status === 500) {
                    errorMessage = 'サーバーエラーが発生しました。しばらく時間をおいてから再度お試しください。';
                }
            }
            
            const errorElement = document.getElementById('card-errors');
            errorElement.textContent = errorMessage;
            
            recordAttempt(email, false);
            setLoading(false, 'card');
            return;
        }

        const data = await response.json();

        // clientSecretの存在確認
        if (!data.clientSecret) {
            const errorElement = document.getElementById('card-errors');
            errorElement.textContent = '決済情報の取得に失敗しました。再度お試しください。';
            
            recordAttempt(email, false);
            setLoading(false, 'card');
            return;
        }

        // PaymentIntentが作成されたら、Stripeで確認を完了
        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(data.clientSecret, {
            payment_method: {
                card: card,
                billing_details: {
                    name: name,
                    email: email,
                },
            },
        });

        if (confirmError) {
            // エラーの種類に応じたメッセージを表示
            let errorMessage = 'カード情報に問題があります。内容をご確認ください。';
            
            // 開発環境では詳細なエラー情報を表示
            if (isDevelopment) {
                console.error('Stripe決済エラー:', confirmError);
                // ユーザーフレンドリーなエラーメッセージに変換
                if (confirmError.type === 'card_error') {
                    switch (confirmError.code) {
                        case 'card_declined':
                            errorMessage = 'カードが拒否されました。カード情報をご確認いただくか、別のカードをお試しください。';
                            break;
                        case 'insufficient_funds':
                            errorMessage = 'カードの残高が不足しています。';
                            break;
                        case 'expired_card':
                            errorMessage = 'カードの有効期限が切れています。';
                            break;
                        case 'incorrect_cvc':
                            errorMessage = 'CVCコードが正しくありません。';
                            break;
                        case 'incorrect_number':
                            errorMessage = 'カード番号が正しくありません。';
                            break;
                        default:
                            errorMessage = confirmError.message || errorMessage;
                    }
                }
            }
            
            const errorElement = document.getElementById('card-errors');
            errorElement.textContent = errorMessage;
            
            recordAttempt(email, false);
            setLoading(false, 'card');
        } else {
            // 決済成功
            if (isDevelopment) {
                console.log('✅ 決済成功:', paymentIntent);
            }
            
            // 成功した場合は試行回数をリセット
            recordAttempt(email, true);
            stripeTokenHandler({ id: data.id, paymentIntent: paymentIntent });
        }

    } catch (error) {
        console.error('Payment error:', error);
        
        // ネットワークエラーなどの場合
        let errorMessage = '処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。';
        
        if (error.message && error.message.includes('fetch')) {
            errorMessage = 'ネットワークエラーが発生しました。インターネット接続をご確認ください。';
        }
        
        const errorElement = document.getElementById('card-errors');
        errorElement.textContent = errorMessage;
        
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
    
    // 決済成功時の処理
    setTimeout(() => {
        setLoading(false, 'card');
        const btn = document.getElementById('submitBtnCard');
        const btnText = document.getElementById('btnTextCard');
        
        btnText.textContent = '完了！';
        btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btn.classList.add('bg-green-500', 'hover:bg-green-600');

        setTimeout(() => {
            // 成功メッセージを表示
            const successMessage = isDevelopment 
                ? `【決済処理が完了しました（テスト環境）】\n\nPayment Intent ID: ${paymentIntent.id}\n\nご登録ありがとうございます。\n確認メールをお送りいたします。`
                : '【決済処理が完了しました】\n\nご登録ありがとうございます。\n確認メールをお送りいたします。';
            
            alert(successMessage);
            
            // フォームをリセット
            closeModal();
            card.clear();
            document.getElementById('name').value = '';
            document.getElementById('email').value = '';
            
            // 本番環境では、必要に応じてリダイレクトや確認ページへの遷移を追加
            // window.location.href = '/payment-success?payment_intent=' + paymentIntent.id;
        }, 500);
    }, 1500);
}

function setLoading(isLoading, method) {
    const btn = method === 'card' ? document.getElementById('submitBtnCard') : document.getElementById('submitBtnPayPay');
    const btnText = method === 'card' ? document.getElementById('btnTextCard') : document.getElementById('btnTextPayPay');
    const btnSpinner = method === 'card' ? document.getElementById('btnSpinnerCard') : document.getElementById('btnSpinnerPayPay');
    // ボタンテキスト: 5名購入後は「¥49,800 を支払う」に変更してください
    const defaultText = method === 'card' ? '¥29,800 を支払う' : 'PayPayで支払う';

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
    // ボタンテキスト: 5名購入後は「¥49,800 を支払う」に変更してください
    btnTextCard.textContent = '¥29,800 を支払う';
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

