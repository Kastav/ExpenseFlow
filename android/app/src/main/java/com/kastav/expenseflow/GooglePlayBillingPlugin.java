package com.kastav.expenseflow;

import android.app.Activity;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.AcknowledgePurchaseResponseListener;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.ProductDetailsResponseListener;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesResponseListener;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native Capacitor Plugin for Google Play In-App Billing v8.
 * Implements Google Play subscriptions for ExpenseFlow Premium.
 */
@CapacitorPlugin(name = "GooglePlayBilling")
public class GooglePlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String PRODUCT_MONTHLY = "expenseflow_premium_monthly";
    private static final String PRODUCT_ANNUAL = "expenseflow_premium_annual";
    private static final String BASE_PLAN_MONTHLY = "monthly-standard";
    private static final String BASE_PLAN_ANNUAL = "annual-standard";

    private interface ConnectionWaiter {
        void onConnected();
        void onFailed(String reason);
    }

    private BillingClient billingClient;
    private final Map<String, ProductDetails> cachedProductDetails = new HashMap<>();
    private final Object connectionLock = new Object();
    private final Object purchaseCallLock = new Object();
    private final List<ConnectionWaiter> pendingConnectionWaiters = new ArrayList<>();
    private boolean isConnecting = false;
    private PluginCall activePurchaseCall = null;

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        PendingPurchasesParams pendingParams = PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build();

        billingClient = BillingClient.newBuilder(context)
                .setListener(this)
                .enablePendingPurchases(pendingParams)
                .build();

        ensureBillingConnected(null);
    }

    private void ensureBillingConnected(@Nullable ConnectionWaiter waiter) {
        if (billingClient == null) {
            if (waiter != null) {
                waiter.onFailed("BillingClient is not initialized.");
            }
            return;
        }

        boolean shouldStartConnection = false;
        synchronized (connectionLock) {
            if (billingClient.isReady()) {
                if (waiter != null) {
                    waiter.onConnected();
                }
                return;
            }
            if (waiter != null) {
                pendingConnectionWaiters.add(waiter);
            }
            if (!isConnecting) {
                isConnecting = true;
                shouldStartConnection = true;
            }
        }

        if (!shouldStartConnection) {
            return;
        }

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
                List<ConnectionWaiter> waitersToNotify;
                synchronized (connectionLock) {
                    isConnecting = false;
                    waitersToNotify = new ArrayList<>(pendingConnectionWaiters);
                    pendingConnectionWaiters.clear();
                }

                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    for (ConnectionWaiter w : waitersToNotify) {
                        w.onConnected();
                    }
                } else {
                    String msg = "Google Play Billing connection failed (code "
                            + billingResult.getResponseCode() + "): "
                            + billingResult.getDebugMessage();
                    for (ConnectionWaiter w : waitersToNotify) {
                        w.onFailed(msg);
                    }
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                List<ConnectionWaiter> waitersToFail;
                synchronized (connectionLock) {
                    isConnecting = false;
                    waitersToFail = new ArrayList<>(pendingConnectionWaiters);
                    pendingConnectionWaiters.clear();
                }

                for (ConnectionWaiter w : waitersToFail) {
                    w.onFailed("Google Play Billing service disconnected before setup completed.");
                }
            }
        });
    }

    @Nullable
    private String getExpectedBasePlanId(@Nullable String productId) {
        if (PRODUCT_MONTHLY.equals(productId)) {
            return BASE_PLAN_MONTHLY;
        }
        if (PRODUCT_ANNUAL.equals(productId)) {
            return BASE_PLAN_ANNUAL;
        }
        return null;
    }

    @Nullable
    private ProductDetails.SubscriptionOfferDetails selectSubscriptionOffer(
            @NonNull ProductDetails pd,
            @Nullable String expectedBasePlanId
    ) {
        List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
        if (offers == null || offers.isEmpty()) {
            return null;
        }

        if (expectedBasePlanId == null || expectedBasePlanId.isEmpty()) {
            return null;
        }

        ProductDetails.SubscriptionOfferDetails firstMatchingBasePlan = null;
        for (ProductDetails.SubscriptionOfferDetails offer : offers) {
            if (expectedBasePlanId.equals(offer.getBasePlanId())) {
                // Prefer the standard base plan offer (without promo offerId) when available
                if (offer.getOfferId() == null || offer.getOfferId().isEmpty()) {
                    return offer;
                }
                if (firstMatchingBasePlan == null) {
                    firstMatchingBasePlan = offer;
                }
            }
        }

        return firstMatchingBasePlan;
    }

    private String mapPurchaseState(int purchaseState) {
        if (purchaseState == Purchase.PurchaseState.PURCHASED) {
            return "PURCHASED";
        }
        if (purchaseState == Purchase.PurchaseState.PENDING) {
            return "PENDING";
        }
        return "UNSPECIFIED";
    }

    private JSObject serializePurchase(@NonNull Purchase p) {
        JSObject obj = new JSObject();
        obj.put("orderId", p.getOrderId());
        obj.put("purchaseToken", p.getPurchaseToken());
        obj.put("purchaseTime", p.getPurchaseTime());
        obj.put("isAcknowledged", p.isAcknowledged());
        obj.put("autoRenewing", p.isAutoRenewing());
        obj.put("purchaseState", mapPurchaseState(p.getPurchaseState()));

        List<String> pids = p.getProducts();
        if (!pids.isEmpty()) {
            obj.put("productId", pids.get(0));
        }
        return obj;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        if (billingClient == null) {
            JSObject ret = new JSObject();
            ret.put("available", false);
            ret.put("platform", "android");
            ret.put("reason", "BillingClient is not initialized.");
            call.resolve(ret);
            return;
        }

        if (billingClient.isReady()) {
            JSObject ret = new JSObject();
            ret.put("available", true);
            ret.put("platform", "android");
            call.resolve(ret);
            return;
        }

        ensureBillingConnected(new ConnectionWaiter() {
            @Override
            public void onConnected() {
                JSObject ret = new JSObject();
                ret.put("available", true);
                ret.put("platform", "android");
                call.resolve(ret);
            }

            @Override
            public void onFailed(String reason) {
                JSObject ret = new JSObject();
                ret.put("available", false);
                ret.put("platform", "android");
                ret.put("reason", reason);
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void queryProductDetails(PluginCall call) {
        if (billingClient == null) {
            call.reject("BillingClient is not initialized");
            return;
        }

        ensureBillingConnected(new ConnectionWaiter() {
            @Override
            public void onConnected() {
                List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
                productList.add(
                        QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(PRODUCT_MONTHLY)
                                .setProductType(BillingClient.ProductType.SUBS)
                                .build()
                );
                productList.add(
                        QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(PRODUCT_ANNUAL)
                                .setProductType(BillingClient.ProductType.SUBS)
                                .build()
                );

                QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                        .setProductList(productList)
                        .build();

                billingClient.queryProductDetailsAsync(params, new ProductDetailsResponseListener() {
                    @Override
                    public void onProductDetailsResponse(@NonNull BillingResult billingResult, @NonNull QueryProductDetailsResult queryResult) {
                        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            JSArray results = new JSArray();
                            cachedProductDetails.clear();

                            for (ProductDetails pd : queryResult.getProductDetailsList()) {
                                String expectedBasePlanId = getExpectedBasePlanId(pd.getProductId());
                                ProductDetails.SubscriptionOfferDetails offer =
                                        selectSubscriptionOffer(pd, expectedBasePlanId);

                                if (offer == null) {
                                    continue;
                                }

                                cachedProductDetails.put(pd.getProductId(), pd);

                                JSObject obj = new JSObject();
                                obj.put("productId", pd.getProductId());
                                obj.put("basePlanId", offer.getBasePlanId());
                                obj.put("title", pd.getTitle());
                                obj.put("description", pd.getDescription());
                                obj.put("offerToken", offer.getOfferToken());

                                List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
                                if (!phases.isEmpty()) {
                                    ProductDetails.PricingPhase phase = phases.get(phases.size() - 1);
                                    obj.put("formattedPrice", phase.getFormattedPrice());
                                    obj.put("priceCurrencyCode", phase.getPriceCurrencyCode());
                                    obj.put("priceAmountMicros", phase.getPriceAmountMicros());
                                    obj.put("billingPeriod", phase.getBillingPeriod());
                                }

                                results.put(obj);
                            }

                            JSObject ret = new JSObject();
                            ret.put("products", results);
                            call.resolve(ret);
                        } else {
                            call.reject("Google Play query failed with response code: " + billingResult.getResponseCode());
                        }
                    }
                });
            }

            @Override
            public void onFailed(String reason) {
                call.reject(reason);
            }
        });
    }

    @PluginMethod
    public void launchBillingFlow(PluginCall call) {
        if (billingClient == null) {
            call.reject("BillingClient is not initialized");
            return;
        }

        String productId = call.getString("productId");
        String expectedBasePlanId = getExpectedBasePlanId(productId);
        if (productId == null || expectedBasePlanId == null) {
            call.reject("Unsupported subscription productId: " + productId);
            return;
        }

        ProductDetails pd = cachedProductDetails.get(productId);
        if (pd == null) {
            call.reject("Product details not loaded for: " + productId);
            return;
        }

        ProductDetails.SubscriptionOfferDetails selectedOffer =
                selectSubscriptionOffer(pd, expectedBasePlanId);
        if (selectedOffer == null) {
            call.reject("Expected base plan (" + expectedBasePlanId + ") offer not found for: " + productId);
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity unavailable to launch Google Play billing flow.");
            return;
        }

        synchronized (purchaseCallLock) {
            if (activePurchaseCall != null) {
                call.reject("Another Google Play purchase flow is already in progress.");
                return;
            }
        }

        final String rawObfuscatedAccountId = call.getString("obfuscatedAccountId");
        final String obfuscatedAccountId =
                rawObfuscatedAccountId != null && !rawObfuscatedAccountId.trim().isEmpty()
                        ? rawObfuscatedAccountId.trim()
                        : null;

        String offerToken = selectedOffer.getOfferToken();
        ensureBillingConnected(new ConnectionWaiter() {
            @Override
            public void onConnected() {
                List<BillingFlowParams.ProductDetailsParams> productDetailsParamsList = new ArrayList<>();
                productDetailsParamsList.add(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(pd)
                                .setOfferToken(offerToken)
                                .build()
                );

                BillingFlowParams.Builder flowBuilder = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(productDetailsParamsList);
                if (obfuscatedAccountId != null) {
                    flowBuilder.setObfuscatedAccountId(obfuscatedAccountId);
                }

                BillingFlowParams billingFlowParams = flowBuilder.build();

                synchronized (purchaseCallLock) {
                    if (activePurchaseCall != null) {
                        call.reject("Another Google Play purchase flow is already in progress.");
                        return;
                    }
                    activePurchaseCall = call;
                }

                BillingResult result = billingClient.launchBillingFlow(activity, billingFlowParams);

                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    synchronized (purchaseCallLock) {
                        if (activePurchaseCall == call) {
                            activePurchaseCall = null;
                        }
                    }
                    call.reject("Launch billing flow failed with code: " + result.getResponseCode());
                }
            }

            @Override
            public void onFailed(String reason) {
                call.reject(reason);
            }
        });
    }

    @PluginMethod
    public void queryPurchases(PluginCall call) {
        if (billingClient == null) {
            call.reject("BillingClient is not initialized");
            return;
        }

        ensureBillingConnected(new ConnectionWaiter() {
            @Override
            public void onConnected() {
                QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build();

                billingClient.queryPurchasesAsync(params, new PurchasesResponseListener() {
                    @Override
                    public void onQueryPurchasesResponse(@NonNull BillingResult billingResult, @NonNull List<Purchase> list) {
                        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            JSArray purchases = new JSArray();
                            for (Purchase p : list) {
                                purchases.put(serializePurchase(p));
                            }

                            JSObject ret = new JSObject();
                            ret.put("purchases", purchases);
                            call.resolve(ret);
                        } else {
                            call.reject("Query purchases failed: " + billingResult.getResponseCode());
                        }
                    }
                });
            }

            @Override
            public void onFailed(String reason) {
                call.reject(reason);
            }
        });
    }

    @PluginMethod
    public void acknowledgePurchase(PluginCall call) {
        String purchaseToken = call.getString("purchaseToken");
        if (purchaseToken == null || purchaseToken.isEmpty()) {
            call.reject("Missing required purchaseToken for acknowledgement");
            return;
        }

        if (billingClient == null) {
            call.reject("BillingClient is not initialized");
            return;
        }

        ensureBillingConnected(new ConnectionWaiter() {
            @Override
            public void onConnected() {
                AcknowledgePurchaseParams acknowledgePurchaseParams =
                        AcknowledgePurchaseParams.newBuilder()
                                .setPurchaseToken(purchaseToken)
                                .build();

                billingClient.acknowledgePurchase(acknowledgePurchaseParams, new AcknowledgePurchaseResponseListener() {
                    @Override
                    public void onAcknowledgePurchaseResponse(@NonNull BillingResult billingResult) {
                        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            JSObject ret = new JSObject();
                            ret.put("success", true);
                            ret.put("purchaseToken", purchaseToken);
                            call.resolve(ret);
                        } else {
                            call.reject("Acknowledge purchase failed with code: " + billingResult.getResponseCode());
                        }
                    }
                });
            }

            @Override
            public void onFailed(String reason) {
                call.reject(reason);
            }
        });
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult billingResult, @Nullable List<Purchase> purchases) {
        PluginCall pendingCall;
        synchronized (purchaseCallLock) {
            pendingCall = activePurchaseCall;
            activePurchaseCall = null;
        }

        if (pendingCall == null) return;

        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            JSArray results = new JSArray();
            for (Purchase p : purchases) {
                results.put(serializePurchase(p));
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("purchases", results);
            pendingCall.resolve(ret);
        } else if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            pendingCall.reject("USER_CANCELED");
        } else {
            pendingCall.reject("Purchase failed with response code: " + billingResult.getResponseCode());
        }
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (purchaseCallLock) {
            activePurchaseCall = null;
        }
        if (billingClient != null) {
            try {
                billingClient.endConnection();
            } catch (Exception ignored) {
                // Safe cleanup on destroy
            }
        }
        super.handleOnDestroy();
    }
}
