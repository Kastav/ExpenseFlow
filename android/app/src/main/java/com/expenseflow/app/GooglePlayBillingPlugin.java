package com.expenseflow.app;

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
 * Native Capacitor Plugin for Google Play In-App Billing v7.
 * Implements Google Play subscriptions for ExpenseFlow Premium.
 */
@CapacitorPlugin(name = "GooglePlayBilling")
public class GooglePlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient billingClient;
    private final Map<String, ProductDetails> cachedProductDetails = new HashMap<>();
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

        startBillingConnection(null);
    }

    private void startBillingConnection(@Nullable final Runnable onConnected) {
        if (billingClient == null) return;

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    if (onConnected != null) {
                        onConnected.run();
                    }
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // Will reconnect on next query or purchase attempt
            }
        });
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ready = billingClient != null && billingClient.isReady();
        ret.put("available", ready);
        ret.put("platform", "android");
        call.resolve(ret);
    }

    @PluginMethod
    public void queryProductDetails(PluginCall call) {
        if (billingClient == null) {
            call.reject("BillingClient is not initialized");
            return;
        }

        Runnable action = () -> {
            List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
            productList.add(
                    QueryProductDetailsParams.Product.newBuilder()
                            .setProductId("expenseflow_premium_monthly")
                            .setProductType(BillingClient.ProductType.SUBS)
                            .build()
            );
            productList.add(
                    QueryProductDetailsParams.Product.newBuilder()
                            .setProductId("expenseflow_premium_annual")
                            .setProductType(BillingClient.ProductType.SUBS)
                            .build()
            );

            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                    .setProductList(productList)
                    .build();

            billingClient.queryProductDetailsAsync(params, new ProductDetailsResponseListener() {
                @Override
                public void onProductDetailsResponse(@NonNull BillingResult billingResult, @NonNull List<ProductDetails> list) {
                    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        JSArray results = new JSArray();
                        cachedProductDetails.clear();

                        for (ProductDetails pd : list) {
                            cachedProductDetails.put(pd.getProductId(), pd);

                            JSObject obj = new JSObject();
                            obj.put("productId", pd.getProductId());
                            obj.put("title", pd.getTitle());
                            obj.put("description", pd.getDescription());

                            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
                            if (offers != null && !offers.isEmpty()) {
                                ProductDetails.SubscriptionOfferDetails offer = offers.get(0);
                                obj.put("offerToken", offer.getOfferToken());

                                List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
                                if (!phases.isEmpty()) {
                                    ProductDetails.PricingPhase phase = phases.get(phases.size() - 1);
                                    obj.put("formattedPrice", phase.getFormattedPrice());
                                    obj.put("priceCurrencyCode", phase.getPriceCurrencyCode());
                                    obj.put("priceAmountMicros", phase.getPriceAmountMicros());
                                    obj.put("billingPeriod", phase.getBillingPeriod());
                                }
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
        };

        if (billingClient.isReady()) {
            action.run();
        } else {
            startBillingConnection(action);
        }
    }

    @PluginMethod
    public void launchBillingFlow(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null || !cachedProductDetails.containsKey(productId)) {
            call.reject("Product details not found or not queried for: " + productId);
            return;
        }

        ProductDetails pd = cachedProductDetails.get(productId);
        if (pd == null || pd.getSubscriptionOfferDetails() == null || pd.getSubscriptionOfferDetails().isEmpty()) {
            call.reject("No subscription offer available for: " + productId);
            return;
        }

        String offerToken = pd.getSubscriptionOfferDetails().get(0).getOfferToken();

        List<BillingFlowParams.ProductDetailsParams> productDetailsParamsList = new ArrayList<>();
        productDetailsParamsList.add(
                BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(pd)
                        .setOfferToken(offerToken)
                        .build()
        );

        BillingFlowParams billingFlowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(productDetailsParamsList)
                .build();

        activePurchaseCall = call;
        BillingResult result = billingClient.launchBillingFlow(getActivity(), billingFlowParams);

        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            activePurchaseCall = null;
            call.reject("Launch billing flow failed with code: " + result.getResponseCode());
        }
    }

    @PluginMethod
    public void queryPurchases(PluginCall call) {
        if (billingClient == null) {
            call.reject("BillingClient is not initialized");
            return;
        }

        Runnable action = () -> {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build();

            billingClient.queryPurchasesAsync(params, new PurchasesResponseListener() {
                @Override
                public void onQueryPurchasesResponse(@NonNull BillingResult billingResult, @NonNull List<Purchase> list) {
                    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        JSArray purchases = new JSArray();

                        for (Purchase p : list) {
                            JSObject obj = new JSObject();
                            obj.put("orderId", p.getOrderId());
                            obj.put("purchaseToken", p.getPurchaseToken());
                            obj.put("purchaseTime", p.getPurchaseTime());
                            obj.put("isAcknowledged", p.isAcknowledged());
                            obj.put("purchaseState", p.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "PURCHASED" : "PENDING");

                            List<String> pids = p.getProducts();
                            if (!pids.isEmpty()) {
                                obj.put("productId", pids.get(0));
                            }

                            purchases.put(obj);
                        }

                        JSObject ret = new JSObject();
                        ret.put("purchases", purchases);
                        call.resolve(ret);
                    } else {
                        call.reject("Query purchases failed: " + billingResult.getResponseCode());
                    }
                }
            });
        };

        if (billingClient.isReady()) {
            action.run();
        } else {
            startBillingConnection(action);
        }
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

        Runnable action = () -> {
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
        };

        if (billingClient.isReady()) {
            action.run();
        } else {
            startBillingConnection(action);
        }
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult billingResult, @Nullable List<Purchase> purchases) {
        if (activePurchaseCall == null) return;

        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            JSArray results = new JSArray();
            for (Purchase p : purchases) {
                JSObject obj = new JSObject();
                obj.put("orderId", p.getOrderId());
                obj.put("purchaseToken", p.getPurchaseToken());
                obj.put("purchaseTime", p.getPurchaseTime());
                obj.put("isAcknowledged", p.isAcknowledged());
                obj.put("purchaseState", p.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "PURCHASED" : "PENDING");

                List<String> pids = p.getProducts();
                if (!pids.isEmpty()) {
                    obj.put("productId", pids.get(0));
                }
                results.put(obj);
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("purchases", results);
            activePurchaseCall.resolve(ret);
        } else if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            activePurchaseCall.reject("USER_CANCELED");
        } else {
            activePurchaseCall.reject("Purchase failed with response code: " + billingResult.getResponseCode());
        }

        activePurchaseCall = null;
    }
}
