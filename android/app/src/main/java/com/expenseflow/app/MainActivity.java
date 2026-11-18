package com.expenseflow.app;

import android.os.Bundle;
import android.view.Window;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);
        registerPlugin(GooglePlayBillingPlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            WindowInsetsControllerCompat insetsController =
                new WindowInsetsControllerCompat(window, window.getDecorView());
            insetsController.setAppearanceLightStatusBars(true);
            insetsController.setAppearanceLightNavigationBars(true);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null) {
                    bridge.eval(
                        "(function(){try{return window.__expenseFlowHandleBack ? Boolean(window.__expenseFlowHandleBack()) : false;}catch(e){return false;}})()",
                        result -> runOnUiThread(() -> {
                            if (!"true".equals(result)) {
                                moveTaskToBack(false);
                            }
                        })
                    );
                } else {
                    moveTaskToBack(false);
                }
            }
        });
    }
}
