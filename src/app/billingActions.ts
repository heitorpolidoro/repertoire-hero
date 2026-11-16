/**
 * RH-202: The billing Server Actions, bundled for client injection (F21).
 */
import {
  getSubscriptionStatusAction,
  startCheckoutAction,
  openCustomerPortalAction,
  completeMockCheckoutAction,
  cancelSubscriptionAction,
} from '@/app/actions/billing'
import type { SubscriptionSettingsActions } from '@/components/settings/SubscriptionSettingsSection'
import type { MockCheckoutActions } from '@/components/settings/MockCheckoutPanel'

export const BILLING_SETTINGS_ACTIONS: SubscriptionSettingsActions = {
  getStatus: getSubscriptionStatusAction,
  startCheckout: startCheckoutAction,
  openPortal: openCustomerPortalAction,
}

export const MOCK_CHECKOUT_ACTIONS: MockCheckoutActions = {
  completeCheckout: completeMockCheckoutAction,
  cancelSubscription: cancelSubscriptionAction,
}
