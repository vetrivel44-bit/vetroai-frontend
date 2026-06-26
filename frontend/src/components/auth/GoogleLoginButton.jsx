import React, { useEffect, useRef } from 'react';

const GoogleLoginButton = ({ clientId, onLogin, theme }) => {
  const buttonRef = useRef(null);
  const onLoginRef = useRef(onLogin);
  const initializedRef = useRef(false);

  useEffect(() => {
    onLoginRef.current = onLogin;
  }, [onLogin]);

  useEffect(() => {
    if (!clientId) return;

    const initializeAndRender = () => {
      if (window.google && window.google.accounts.id) {
        // Only initialize once to prevent GSI_LOGGER warnings
        if (!initializedRef.current) {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (res) => {
              console.log("📩 Google Login Callback Received");
              if (onLoginRef.current) {
                onLoginRef.current(res);
              }
            },
            auto_select: false,
            cancel_on_tap_outside: true,
            itp_support: true,
            use_fedcm_for_prompt: true
          });
          initializedRef.current = true;
        }

        if (buttonRef.current) {
          const w = Math.min(320, buttonRef.current.parentElement?.clientWidth || 320, window.innerWidth - 48);
          window.google.accounts.id.renderButton(buttonRef.current, {
            theme: theme === "dark" ? "filled_black" : "outline",
            size: "large",
            width: w,
            shape: "pill",
          });
        }
      }
    };

    // If script is already loaded
    if (window.google && window.google.accounts.id) {
      initializeAndRender();
    } else {
      // Wait for script to load or event to fire
      const checkInterval = setInterval(() => {
        if (window.google && window.google.accounts.id) {
          initializeAndRender();
          clearInterval(checkInterval);
        }
      }, 500);
      
      const handleReady = () => {
        initializeAndRender();
        clearInterval(checkInterval);
      };
      
      window.addEventListener('google-ready', handleReady);
      return () => {
        window.removeEventListener('google-ready', handleReady);
        clearInterval(checkInterval);
      };
    }
  }, [clientId, theme]);

  return (
    <div 
      ref={buttonRef} 
      id="google-signin-button" 
      style={{ display: "flex", justifyContent: "center", minHeight: '44px' }}
    />
  );
};

export default GoogleLoginButton;
