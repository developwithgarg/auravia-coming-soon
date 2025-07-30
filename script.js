// Email form handling
document.addEventListener('DOMContentLoaded', function() {
    const emailForm = document.getElementById('emailForm');
    const emailInput = document.getElementById('email');
    const formMessage = document.getElementById('formMessage');
    const notifyBtn = emailForm.querySelector('.notify-btn');
    
    // Email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    // Form submission handler
    emailForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        
        // Clear previous messages
        formMessage.className = 'form-message';
        formMessage.textContent = '';
        
        // Validate email
        if (!email) {
            showMessage('Please enter your email address.', 'error');
            return;
        }
        
        if (!emailRegex.test(email)) {
            showMessage('Please enter a valid email address.', 'error');
            return;
        }
        
        // Show loading state
        notifyBtn.textContent = 'Submitting...';
        notifyBtn.disabled = true;
        
        // Send email to backend API
        fetch('/api/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: email })
        })
        .then(response => response.json())
        .then(data => {
            // Reset button
            notifyBtn.textContent = '✨ Keep Me Updated';
            notifyBtn.disabled = false;
            
            if (data.success) {
                // Show success message
                showMessage(data.message, 'success');
                // Clear form
                emailInput.value = '';
            } else {
                // Show error message
                showMessage(data.message, 'error');
            }
        })
        .catch(error => {
            console.error('Subscription error:', error);
            
            // Reset button
            notifyBtn.textContent = '✨ Keep Me Updated';
            notifyBtn.disabled = false;
            
            // Show error message
            showMessage('Something went wrong. Please try again later.', 'error');
        });
    });
    
    // Real-time email validation
    emailInput.addEventListener('input', function() {
        const email = this.value.trim();
        
        if (email && !emailRegex.test(email)) {
            this.style.borderColor = '#dc3545';
        } else {
            this.style.borderColor = '';
        }
    });
    
    // Show message function
    function showMessage(message, type) {
        formMessage.textContent = message;
        formMessage.className = `form-message ${type}`;
    }
    
    // Store email function (for demo purposes)
    function storeEmail(email) {
        try {
            let emails = JSON.parse(localStorage.getItem('auraviaEmails') || '[]');
            if (!emails.includes(email)) {
                emails.push(email);
                localStorage.setItem('auraviaEmails', JSON.stringify(emails));
            }
        } catch (error) {
            console.log('Error storing email:', error);
        }
    }
    
    // Smooth scroll for mobile
    if (window.innerWidth <= 768) {
        const container = document.querySelector('.container');
        container.style.scrollBehavior = 'smooth';
    }
    
    // Social media click tracking
    const socialLinks = document.querySelectorAll('.social-icons a');
    socialLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const platform = this.href.split('/').pop();
            console.log(`Social media click: ${platform}`);
            
            // Add analytics tracking here if needed
            // gtag('event', 'social_click', { platform: platform });
        });
    });
    
    // Parallax effect for watermark on scroll (subtle)
    let ticking = false;
    
    function updateWatermark() {
        const scrolled = window.pageYOffset;
        const watermark = document.querySelector('.watermark');
        
        if (watermark) {
            const yPos = -(scrolled * 0.1);
            watermark.style.transform = `translate(-50%, calc(-50% + ${yPos}px))`;
        }
        
        ticking = false;
    }
    
    function requestTick() {
        if (!ticking) {
            requestAnimationFrame(updateWatermark);
            ticking = true;
        }
    }
    
    window.addEventListener('scroll', requestTick);
    
    // Responsive font size adjustment
    function adjustFontSize() {
        const viewport = window.innerWidth;
        const brandName = document.querySelector('.brand-name');
        
        if (viewport < 480) {
            brandName.style.letterSpacing = '0.1em';
        } else {
            brandName.style.letterSpacing = '0.2em';
        }
    }
    
    window.addEventListener('resize', adjustFontSize);
    adjustFontSize(); // Initial call
    
    // Form input focus enhancement
    emailInput.addEventListener('focus', function() {
        this.parentElement.style.transform = 'translateY(-2px)';
    });
    
    emailInput.addEventListener('blur', function() {
        if (!this.value) {
            this.parentElement.style.transform = 'translateY(0)';
        }
    });
    
    // Keyboard navigation enhancement
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
            emailInput.focus();
        }
    });
    
    // Preload critical resources
    const preloadLinks = [
        'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Lato:wght@300;400;500&display=swap',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
    ];
    
    preloadLinks.forEach(href => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'style';
        link.href = href;
        document.head.appendChild(link);
    });
});

// Performance optimization: Intersection Observer for animations
if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animationPlayState = 'running';
            }
        });
    }, {
        threshold: 0.1
    });
    
    // Observe animated elements
    document.querySelectorAll('.container > *').forEach(el => {
        el.style.animationPlayState = 'paused';
        observer.observe(el);
    });
}

// Error handling for external resources
window.addEventListener('error', function(e) {
    if (e.target.tagName === 'LINK' || e.target.tagName === 'SCRIPT') {
        console.warn('Failed to load external resource:', e.target.src || e.target.href);
        
        // Fallback for Font Awesome if CDN fails
        if (e.target.href && e.target.href.includes('font-awesome')) {
            const fallbackCSS = document.createElement('style');
            fallbackCSS.textContent = `
                .social-icons a::before {
                    content: "→";
                    font-family: Arial, sans-serif;
                    font-weight: bold;
                }
            `;
            document.head.appendChild(fallbackCSS);
        }
    }
});
