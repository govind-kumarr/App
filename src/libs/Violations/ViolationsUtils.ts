import reject from 'lodash/reject';
import Onyx from 'react-native-onyx';
import type {OnyxUpdate} from 'react-native-onyx';
import type {LocaleContextProps} from '@components/LocaleContextProvider';
import * as CurrencyUtils from '@libs/CurrencyUtils';
import DateUtils from '@libs/DateUtils';
import {getDistanceRateCustomUnitRate, getSortedTagKeys} from '@libs/PolicyUtils';
import * as TransactionUtils from '@libs/TransactionUtils';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Policy, PolicyCategories, PolicyTagLists, Transaction, TransactionViolation, ViolationName} from '@src/types/onyx';

/**
 * Calculates tag out of policy and missing tag violations for the given transaction
 */
function getTagViolationsForSingleLevelTags(
    updatedTransaction: Transaction,
    transactionViolations: TransactionViolation[],
    policyRequiresTags: boolean,
    policyTagList: PolicyTagLists,
): TransactionViolation[] {
    const policyTagKeys = Object.keys(policyTagList);
    const policyTagListName = policyTagKeys.at(0) ?? '';
    const policyTags = policyTagList[policyTagListName]?.tags;
    const hasTagOutOfPolicyViolation = transactionViolations.some((violation) => violation.name === CONST.VIOLATIONS.TAG_OUT_OF_POLICY);
    const hasMissingTagViolation = transactionViolations.some((violation) => violation.name === CONST.VIOLATIONS.MISSING_TAG);
    const isTagInPolicy = policyTags ? !!policyTags[updatedTransaction.tag ?? '']?.enabled : false;
    let newTransactionViolations = [...transactionViolations];

    // Add 'tagOutOfPolicy' violation if tag is not in policy
    if (!hasTagOutOfPolicyViolation && updatedTransaction.tag && !isTagInPolicy) {
        newTransactionViolations.push({name: CONST.VIOLATIONS.TAG_OUT_OF_POLICY, type: CONST.VIOLATION_TYPES.VIOLATION});
    }

    // Remove 'tagOutOfPolicy' violation if tag is in policy
    if (hasTagOutOfPolicyViolation && updatedTransaction.tag && isTagInPolicy) {
        newTransactionViolations = reject(newTransactionViolations, {name: CONST.VIOLATIONS.TAG_OUT_OF_POLICY});
    }

    // Remove 'missingTag' violation if tag is valid according to policy
    if (hasMissingTagViolation && isTagInPolicy) {
        newTransactionViolations = reject(newTransactionViolations, {name: CONST.VIOLATIONS.MISSING_TAG});
    }

    // Add 'missingTag violation' if tag is required and not set
    if (!hasMissingTagViolation && !updatedTransaction.tag && policyRequiresTags) {
        newTransactionViolations.push({name: CONST.VIOLATIONS.MISSING_TAG, type: CONST.VIOLATION_TYPES.VIOLATION});
    }
    return newTransactionViolations;
}

/**
 * Calculates missing tag violations for policies with dependent tags
 */
function getTagViolationsForDependentTags(policyTagList: PolicyTagLists, transactionViolations: TransactionViolation[], tagName: string) {
    const tagViolations = [...transactionViolations];

    if (!tagName) {
        Object.values(policyTagList).forEach((tagList) =>
            tagViolations.push({
                name: CONST.VIOLATIONS.MISSING_TAG,
                type: CONST.VIOLATION_TYPES.VIOLATION,
                data: {tagName: tagList.name},
            }),
        );
    } else {
        const tags = TransactionUtils.getTagArrayFromName(tagName);
        if (Object.keys(policyTagList).length !== tags.length || tags.includes('')) {
            tagViolations.push({
                name: CONST.VIOLATIONS.ALL_TAG_LEVELS_REQUIRED,
                type: CONST.VIOLATION_TYPES.VIOLATION,
                data: {},
            });
        }
    }

    return tagViolations;
}

/**
 * Calculates missing tag violations for policies with independent tags
 */
function getTagViolationForIndependentTags(policyTagList: PolicyTagLists, transactionViolations: TransactionViolation[], transaction: Transaction) {
    const policyTagKeys = getSortedTagKeys(policyTagList);
    const selectedTags = TransactionUtils.getTagArrayFromName(transaction?.tag ?? '');
    let newTransactionViolations = [...transactionViolations];

    newTransactionViolations = newTransactionViolations.filter(
        (violation) => violation.name !== CONST.VIOLATIONS.SOME_TAG_LEVELS_REQUIRED && violation.name !== CONST.VIOLATIONS.TAG_OUT_OF_POLICY,
    );

    // We first get the errorIndexes for someTagLevelsRequired. If it's not empty, we puth SOME_TAG_LEVELS_REQUIRED in Onyx.
    // Otherwise, we put TAG_OUT_OF_POLICY in Onyx (when applicable)
    const errorIndexes = [];
    for (let i = 0; i < policyTagKeys.length; i++) {
        const isTagRequired = policyTagList[policyTagKeys[i]].required ?? true;
        const isTagSelected = !!selectedTags.at(i);
        if (isTagRequired && (!isTagSelected || (selectedTags.length === 1 && selectedTags.at(0) === ''))) {
            errorIndexes.push(i);
        }
    }
    if (errorIndexes.length !== 0) {
        newTransactionViolations.push({
            name: CONST.VIOLATIONS.SOME_TAG_LEVELS_REQUIRED,
            type: CONST.VIOLATION_TYPES.VIOLATION,
            data: {
                errorIndexes,
            },
        });
    } else {
        let hasInvalidTag = false;
        for (let i = 0; i < policyTagKeys.length; i++) {
            const selectedTag = selectedTags.at(i);
            const tags = policyTagList[policyTagKeys[i]].tags;
            const isTagInPolicy = Object.values(tags).some((tag) => tag.name === selectedTag && !!tag.enabled);
            if (!isTagInPolicy && selectedTag) {
                newTransactionViolations.push({
                    name: CONST.VIOLATIONS.TAG_OUT_OF_POLICY,
                    type: CONST.VIOLATION_TYPES.VIOLATION,
                    data: {
                        tagName: policyTagKeys.at(i),
                    },
                });
                hasInvalidTag = true;
                break;
            }
        }
        if (!hasInvalidTag) {
            newTransactionViolations = reject(newTransactionViolations, {
                name: CONST.VIOLATIONS.TAG_OUT_OF_POLICY,
            });
        }
    }
    return newTransactionViolations;
}

/**
 * Calculates tag violations for a transaction on a policy with multi level tags
 */
function getTagViolationsForMultiLevelTags(
    updatedTransaction: Transaction,
    transactionViolations: TransactionViolation[],
    policyTagList: PolicyTagLists,
    hasDependentTags: boolean,
): TransactionViolation[] {
    const tagViolations = [
        CONST.VIOLATIONS.SOME_TAG_LEVELS_REQUIRED,
        CONST.VIOLATIONS.TAG_OUT_OF_POLICY,
        CONST.VIOLATIONS.MISSING_TAG,
        CONST.VIOLATIONS.ALL_TAG_LEVELS_REQUIRED,
    ] as ViolationName[];
    const filteredTransactionViolations = transactionViolations.filter((violation) => !tagViolations.includes(violation.name));

    if (hasDependentTags) {
        return getTagViolationsForDependentTags(policyTagList, filteredTransactionViolations, updatedTransaction.tag ?? '');
    }

    return getTagViolationForIndependentTags(policyTagList, filteredTransactionViolations, updatedTransaction);
}

const ViolationsUtils = {
    /**
     * Checks a transaction for policy violations and returns an object with Onyx method, key and updated transaction
     * violations.
     */
    getViolationsOnyxData(
        updatedTransaction: Transaction,
        transactionViolations: TransactionViolation[],
        policy: Policy,
        policyTagList: PolicyTagLists,
        policyCategories: PolicyCategories,
        hasDependentTags: boolean,
        isInvoiceTransaction: boolean,
    ): OnyxUpdate {
        const isPartialTransaction = TransactionUtils.isPartialMerchant(TransactionUtils.getMerchant(updatedTransaction)) && TransactionUtils.isAmountMissing(updatedTransaction);
        if (isPartialTransaction) {
            return {
                onyxMethod: Onyx.METHOD.SET,
                key: `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${updatedTransaction.transactionID}`,
                value: transactionViolations,
            };
        }

        let newTransactionViolations = [...transactionViolations];

        // Calculate client-side category violations
        const policyRequiresCategories = !!policy.requiresCategory;
        if (policyRequiresCategories) {
            const hasCategoryOutOfPolicyViolation = transactionViolations.some((violation) => violation.name === 'categoryOutOfPolicy');
            const hasMissingCategoryViolation = transactionViolations.some((violation) => violation.name === 'missingCategory');
            const categoryKey = updatedTransaction.category;
            const isCategoryInPolicy = categoryKey ? policyCategories?.[categoryKey]?.enabled : false;

            // Add 'categoryOutOfPolicy' violation if category is not in policy
            if (!hasCategoryOutOfPolicyViolation && categoryKey && !isCategoryInPolicy) {
                newTransactionViolations.push({name: 'categoryOutOfPolicy', type: CONST.VIOLATION_TYPES.VIOLATION});
            }

            // Remove 'categoryOutOfPolicy' violation if category is in policy
            if (hasCategoryOutOfPolicyViolation && updatedTransaction.category && isCategoryInPolicy) {
                newTransactionViolations = reject(newTransactionViolations, {name: 'categoryOutOfPolicy'});
            }

            // Remove 'missingCategory' violation if category is valid according to policy
            if (hasMissingCategoryViolation && isCategoryInPolicy) {
                newTransactionViolations = reject(newTransactionViolations, {name: 'missingCategory'});
            }

            // Add 'missingCategory' violation if category is required and not set
            if (!hasMissingCategoryViolation && policyRequiresCategories && !categoryKey) {
                newTransactionViolations.push({name: 'missingCategory', type: CONST.VIOLATION_TYPES.VIOLATION, showInReview: true});
            }
        }

        // Calculate client-side tag violations
        const policyRequiresTags = !!policy.requiresTag;
        if (policyRequiresTags) {
            newTransactionViolations =
                Object.keys(policyTagList).length === 1
                    ? getTagViolationsForSingleLevelTags(updatedTransaction, newTransactionViolations, policyRequiresTags, policyTagList)
                    : getTagViolationsForMultiLevelTags(updatedTransaction, newTransactionViolations, policyTagList, hasDependentTags);
        }

        if (updatedTransaction?.comment?.customUnit?.customUnitRateID && !!getDistanceRateCustomUnitRate(policy, updatedTransaction?.comment?.customUnit?.customUnitRateID)) {
            newTransactionViolations = reject(newTransactionViolations, {name: CONST.VIOLATIONS.CUSTOM_UNIT_OUT_OF_POLICY});
        }

        const isControlPolicy = policy.type === CONST.POLICY.TYPE.CORPORATE;
        const inputDate = new Date(updatedTransaction.modifiedCreated ?? updatedTransaction.created);
        const shouldDisplayFutureDateViolation = !isInvoiceTransaction && DateUtils.isFutureDay(inputDate) && isControlPolicy;
        const hasReceiptRequiredViolation = transactionViolations.some((violation) => violation.name === 'receiptRequired');
        const hasOverLimitViolation = transactionViolations.some((violation) => violation.name === 'overLimit');
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const amount = updatedTransaction.modifiedAmount || updatedTransaction.amount;
        const shouldShowReceiptRequiredViolation =
            !isInvoiceTransaction &&
            policy.maxExpenseAmountNoReceipt &&
            Math.abs(amount) > policy.maxExpenseAmountNoReceipt &&
            !TransactionUtils.hasReceipt(updatedTransaction) &&
            isControlPolicy;
        const shouldShowOverLimitViolation = !isInvoiceTransaction && policy.maxExpenseAmount && Math.abs(amount) > policy.maxExpenseAmount && isControlPolicy;
        const hasFutureDateViolation = transactionViolations.some((violation) => violation.name === 'futureDate');
        // Add 'futureDate' violation if transaction date is in the future and policy type is corporate
        if (!hasFutureDateViolation && shouldDisplayFutureDateViolation) {
            newTransactionViolations.push({name: CONST.VIOLATIONS.FUTURE_DATE, type: CONST.VIOLATION_TYPES.VIOLATION, showInReview: true});
        }

        // Remove 'futureDate' violation if transaction date is not in the future
        if (hasFutureDateViolation && !shouldDisplayFutureDateViolation) {
            newTransactionViolations = reject(newTransactionViolations, {name: CONST.VIOLATIONS.FUTURE_DATE});
        }

        if (!hasReceiptRequiredViolation && shouldShowReceiptRequiredViolation) {
            newTransactionViolations.push({
                name: CONST.VIOLATIONS.RECEIPT_REQUIRED,
                data: {
                    formattedLimit: CurrencyUtils.convertAmountToDisplayString(policy.maxExpenseAmountNoReceipt, policy.outputCurrency),
                },
                type: CONST.VIOLATION_TYPES.VIOLATION,
                showInReview: true,
            });
        }

        if (hasReceiptRequiredViolation && !shouldShowReceiptRequiredViolation) {
            newTransactionViolations = reject(newTransactionViolations, {name: CONST.VIOLATIONS.RECEIPT_REQUIRED});
        }

        if (!hasOverLimitViolation && shouldShowOverLimitViolation) {
            newTransactionViolations.push({
                name: CONST.VIOLATIONS.OVER_LIMIT,
                data: {
                    formattedLimit: CurrencyUtils.convertAmountToDisplayString(policy.maxExpenseAmount, policy.outputCurrency),
                },
                type: CONST.VIOLATION_TYPES.VIOLATION,
                showInReview: true,
            });
        }

        if (hasOverLimitViolation && !shouldShowOverLimitViolation) {
            newTransactionViolations = reject(newTransactionViolations, {name: CONST.VIOLATIONS.OVER_LIMIT});
        }

        return {
            onyxMethod: Onyx.METHOD.SET,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${updatedTransaction.transactionID}`,
            value: newTransactionViolations,
        };
    },

    /**
     * Gets the translated message for each violation type.
     *
     * Necessary because `translate` throws a type error if you attempt to pass it a template strings, when the
     * possible values could be either translation keys that resolve to  strings or translation keys that resolve to
     * functions.
     */
    getViolationTranslation(violation: TransactionViolation, translate: LocaleContextProps['translate'], canEdit = true): string {
        const {
            brokenBankConnection = false,
            isAdmin = false,
            email,
            isTransactionOlderThan7Days = false,
            member,
            category,
            rejectedBy = '',
            rejectReason = '',
            formattedLimit = '',
            surcharge = 0,
            invoiceMarkup = 0,
            maxAge = 0,
            tagName,
            taxName,
            type,
            rterType,
            message = '',
        } = violation.data ?? {};

        switch (violation.name) {
            case 'allTagLevelsRequired':
                return translate('violations.allTagLevelsRequired');
            case 'autoReportedRejectedExpense':
                return translate('violations.autoReportedRejectedExpense', {
                    rejectedBy,
                    rejectReason,
                });
            case 'billableExpense':
                return translate('violations.billableExpense');
            case 'cashExpenseWithNoReceipt':
                return translate('violations.cashExpenseWithNoReceipt', {formattedLimit});
            case 'categoryOutOfPolicy':
                return translate('violations.categoryOutOfPolicy');
            case 'conversionSurcharge':
                return translate('violations.conversionSurcharge', {surcharge});
            case 'customUnitOutOfPolicy':
                return translate('violations.customUnitOutOfPolicy');
            case 'duplicatedTransaction':
                return translate('violations.duplicatedTransaction');
            case 'fieldRequired':
                return translate('violations.fieldRequired');
            case 'futureDate':
                return translate('violations.futureDate');
            case 'invoiceMarkup':
                return translate('violations.invoiceMarkup', {invoiceMarkup});
            case 'maxAge':
                return translate('violations.maxAge', {maxAge});
            case 'missingCategory':
                return translate('violations.missingCategory');
            case 'missingComment':
                return translate('violations.missingComment');
            case 'missingTag':
                return translate('violations.missingTag', {tagName});
            case 'modifiedAmount':
                return translate('violations.modifiedAmount', {type, displayPercentVariance: violation.data?.displayPercentVariance});
            case 'modifiedDate':
                return translate('violations.modifiedDate');
            case 'nonExpensiworksExpense':
                return translate('violations.nonExpensiworksExpense');
            case 'overAutoApprovalLimit':
                return translate('violations.overAutoApprovalLimit', {formattedLimit});
            case 'overCategoryLimit':
                return translate('violations.overCategoryLimit', {formattedLimit});
            case 'overLimit':
                return translate('violations.overLimit', {formattedLimit});
            case 'overLimitAttendee':
                return translate('violations.overLimitAttendee', {formattedLimit});
            case 'perDayLimit':
                return translate('violations.perDayLimit', {formattedLimit});
            case 'receiptNotSmartScanned':
                return translate('violations.receiptNotSmartScanned');
            case 'receiptRequired':
                return translate('violations.receiptRequired', {formattedLimit, category});
            case 'customRules':
                return translate('violations.customRules', {message});
            case 'rter':
                return translate('violations.rter', {
                    brokenBankConnection,
                    isAdmin,
                    email,
                    isTransactionOlderThan7Days,
                    member,
                    rterType,
                });
            case 'smartscanFailed':
                return translate('violations.smartscanFailed', {canEdit});
            case 'someTagLevelsRequired':
                return translate('violations.someTagLevelsRequired', {tagName});
            case 'tagOutOfPolicy':
                return translate('violations.tagOutOfPolicy', {tagName});
            case 'taxAmountChanged':
                return translate('violations.taxAmountChanged');
            case 'taxOutOfPolicy':
                return translate('violations.taxOutOfPolicy', {taxName});
            case 'taxRateChanged':
                return translate('violations.taxRateChanged');
            case 'taxRequired':
                return translate('violations.taxRequired');
            case 'hold':
                return translate('violations.hold');
            case CONST.VIOLATIONS.PROHIBITED_EXPENSE:
                return translate('violations.prohibitedExpense', {
                    prohibitedExpenseType: violation.data?.prohibitedExpenseRule ?? '',
                });
            case CONST.VIOLATIONS.RECEIPT_GENERATED_WITH_AI:
                return translate('violations.receiptGeneratedWithAI');
            default:
                // The interpreter should never get here because the switch cases should be exhaustive.
                // If typescript is showing an error on the assertion below it means the switch statement is out of
                // sync with the `ViolationNames` type, and one or the other needs to be updated.
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                return violation.name as never;
        }
    },

    // We have to use regex, because Violation limit is given in a inconvenient form: "$2,000.00"
    getViolationAmountLimit(violation: TransactionViolation): number {
        return Number(violation.data?.formattedLimit?.replace(CONST.VIOLATION_LIMIT_REGEX, ''));
    },
};

export default ViolationsUtils;
