import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useMemo, useRef, useState} from 'react';
import type {GestureResponderEvent, ViewStyle} from 'react-native';
import {StyleSheet, View} from 'react-native';
import {useOnyx} from 'react-native-onyx';
import DisplayNames from '@components/DisplayNames';
import Hoverable from '@components/Hoverable';
import Icon from '@components/Icon';
import * as Expensicons from '@components/Icon/Expensicons';
import MultipleAvatars from '@components/MultipleAvatars';
import OfflineWithFeedback from '@components/OfflineWithFeedback';
import {useSession} from '@components/OnyxProvider';
import PressableWithSecondaryInteraction from '@components/PressableWithSecondaryInteraction';
import {useProductTrainingContext} from '@components/ProductTrainingContext';
import SubscriptAvatar from '@components/SubscriptAvatar';
import Text from '@components/Text';
import Tooltip from '@components/Tooltip';
import EducationalTooltip from '@components/Tooltip/EducationalTooltip';
import useLocalize from '@hooks/useLocalize';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import useRootNavigationState from '@hooks/useRootNavigationState';
import useStyleUtils from '@hooks/useStyleUtils';
import useTheme from '@hooks/useTheme';
import useThemeStyles from '@hooks/useThemeStyles';
import DateUtils from '@libs/DateUtils';
import DomUtils from '@libs/DomUtils';
import {shouldOptionShowTooltip, shouldUseBoldText} from '@libs/OptionsListUtils';
import Parser from '@libs/Parser';
import Performance from '@libs/Performance';
import ReportActionComposeFocusManager from '@libs/ReportActionComposeFocusManager';
import {
    isAdminRoom,
    isChatUsedForOnboarding as isChatUsedForOnboardingReportUtils,
    isConciergeChatReport,
    isGroupChat,
    isOneOnOneChat,
    isPolicyExpenseChat,
    isSystemChat,
    isThread,
    requiresAttentionFromCurrentUser,
} from '@libs/ReportUtils';
import {showContextMenu} from '@pages/home/report/ContextMenu/ReportActionContextMenu';
import FreeTrial from '@pages/settings/Subscription/FreeTrial';
import variables from '@styles/variables';
import Timing from '@userActions/Timing';
import CONST from '@src/CONST';
import NAVIGATORS from '@src/NAVIGATORS';
import ONYXKEYS from '@src/ONYXKEYS';
import {isEmptyObject} from '@src/types/utils/EmptyObject';
import type {OptionRowLHNProps} from './types';

function OptionRowLHN({reportID, isFocused = false, onSelectRow = () => {}, optionItem, viewMode = 'default', style, onLayout = () => {}, hasDraftComment}: OptionRowLHNProps) {
    const theme = useTheme();
    const styles = useThemeStyles();
    const popoverAnchor = useRef<View>(null);
    const StyleUtils = useStyleUtils();
    const [isScreenFocused, setIsScreenFocused] = useState(false);
    const {shouldUseNarrowLayout} = useResponsiveLayout();

    const [report] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${optionItem?.reportID}`);
    const [activePolicyID] = useOnyx(ONYXKEYS.NVP_ACTIVE_POLICY_ID);
    const [introSelected] = useOnyx(ONYXKEYS.NVP_INTRO_SELECTED);
    const [isFullscreenVisible] = useOnyx(ONYXKEYS.FULLSCREEN_VISIBILITY);
    const session = useSession();
    const shouldShowWorkspaceChatTooltip = isPolicyExpenseChat(report) && !isThread(report) && activePolicyID === report?.policyID && session?.accountID === report?.ownerAccountID;
    const isOnboardingGuideAssigned = introSelected?.choice === CONST.ONBOARDING_CHOICES.MANAGE_TEAM && !session?.email?.includes('+');
    const isChatUsedForOnboarding = isChatUsedForOnboardingReportUtils(report, introSelected?.choice);
    const shouldShowGetStartedTooltip = isOnboardingGuideAssigned ? isAdminRoom(report) && isChatUsedForOnboarding : isConciergeChatReport(report);

    const isReportsSplitNavigatorLast = useRootNavigationState((state) => state?.routes?.at(-1)?.name === NAVIGATORS.REPORTS_SPLIT_NAVIGATOR);

    const {tooltipToRender, shouldShowTooltip} = useMemo(() => {
        // TODO: CONCIERGE_LHN_GBR tooltip will be replaced by a tooltip in the #admins room
        // https://github.com/Expensify/App/issues/57045#issuecomment-2701455668
        const tooltip = shouldShowGetStartedTooltip ? CONST.PRODUCT_TRAINING_TOOLTIP_NAMES.CONCIERGE_LHN_GBR : CONST.PRODUCT_TRAINING_TOOLTIP_NAMES.LHN_WORKSPACE_CHAT_TOOLTIP;
        const shouldShowTooltips = shouldShowWorkspaceChatTooltip || shouldShowGetStartedTooltip;
        const shouldTooltipBeVisible = shouldUseNarrowLayout ? isScreenFocused && isReportsSplitNavigatorLast : isReportsSplitNavigatorLast && !isFullscreenVisible;

        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        return {tooltipToRender: tooltip, shouldShowTooltip: shouldShowTooltips && shouldTooltipBeVisible};
    }, [shouldShowGetStartedTooltip, shouldShowWorkspaceChatTooltip, isScreenFocused, shouldUseNarrowLayout, isReportsSplitNavigatorLast, isFullscreenVisible]);

    const {shouldShowProductTrainingTooltip, renderProductTrainingTooltip, hideProductTrainingTooltip} = useProductTrainingContext(tooltipToRender, shouldShowTooltip);

    const {translate} = useLocalize();
    const [isContextMenuActive, setIsContextMenuActive] = useState(false);

    useFocusEffect(
        useCallback(() => {
            setIsScreenFocused(true);
            return () => {
                setIsScreenFocused(false);
            };
        }, []),
    );

    const isInFocusMode = viewMode === CONST.OPTION_MODE.COMPACT;
    const sidebarInnerRowStyle = StyleSheet.flatten<ViewStyle>(
        isInFocusMode
            ? [styles.chatLinkRowPressable, styles.flexGrow1, styles.optionItemAvatarNameWrapper, styles.optionRowCompact, styles.justifyContentCenter]
            : [styles.chatLinkRowPressable, styles.flexGrow1, styles.optionItemAvatarNameWrapper, styles.optionRow, styles.justifyContentCenter],
    );

    if (!optionItem && !isFocused) {
        // rendering null as a render item causes the FlashList to render all
        // its children and consume significant memory on the first render. We can avoid this by
        // rendering a placeholder view instead. This behaviour is only observed when we
        // first sign in to the App.
        // We can fix this by checking if the optionItem is null and the component is not focused.
        // Which means that the currentReportID is not the same as the reportID. The currentReportID
        // in this case is empty and hence the component is not focused.
        return <View style={sidebarInnerRowStyle} />;
    }

    if (!optionItem) {
        // This is the case when the component is focused and the optionItem is null.
        // For example, when you submit an expense in offline mode and click on the
        // generated expense report, we would only see the Report Details but no item in LHN.
        return null;
    }

    const hasBrickError = optionItem.brickRoadIndicator === CONST.BRICK_ROAD_INDICATOR_STATUS.ERROR;
    const shouldShowGreenDotIndicator = !hasBrickError && requiresAttentionFromCurrentUser(optionItem, optionItem.parentReportAction);
    const textStyle = isFocused ? styles.sidebarLinkActiveText : styles.sidebarLinkText;
    const textUnreadStyle = shouldUseBoldText(optionItem) ? [textStyle, styles.sidebarLinkTextBold] : [textStyle];
    const displayNameStyle = [styles.optionDisplayName, styles.optionDisplayNameCompact, styles.pre, textUnreadStyle, style];
    const alternateTextStyle = isInFocusMode
        ? [textStyle, styles.textLabelSupporting, styles.optionAlternateTextCompact, styles.ml2, style]
        : [textStyle, styles.optionAlternateText, styles.textLabelSupporting, style];

    const contentContainerStyles = isInFocusMode ? [styles.flex1, styles.flexRow, styles.overflowHidden, StyleUtils.getCompactContentContainerStyles()] : [styles.flex1];
    const hoveredBackgroundColor = !!styles.sidebarLinkHover && 'backgroundColor' in styles.sidebarLinkHover ? styles.sidebarLinkHover.backgroundColor : theme.sidebar;
    const focusedBackgroundColor = styles.sidebarLinkActive.backgroundColor;

    /**
     * Show the ReportActionContextMenu modal popover.
     *
     * @param [event] - A press event.
     */
    const showPopover = (event: MouseEvent | GestureResponderEvent) => {
        if (!isScreenFocused && shouldUseNarrowLayout) {
            return;
        }
        setIsContextMenuActive(true);
        showContextMenu({
            type: CONST.CONTEXT_MENU_TYPES.REPORT,
            event,
            selection: '',
            contextMenuAnchor: popoverAnchor.current,
            report: {
                reportID,
                originalReportID: reportID,
                isPinnedChat: optionItem.isPinned,
                isUnreadChat: !!optionItem.isUnread,
            },
            reportAction: {
                reportActionID: '-1',
            },
            callbacks: {
                onHide: () => setIsContextMenuActive(false),
            },
        });
    };

    const emojiCode = optionItem.status?.emojiCode ?? '';
    const statusText = optionItem.status?.text ?? '';
    const statusClearAfterDate = optionItem.status?.clearAfter ?? '';
    const formattedDate = DateUtils.getStatusUntilDate(statusClearAfterDate);
    const statusContent = formattedDate ? `${statusText ? `${statusText} ` : ''}(${formattedDate})` : statusText;
    const isStatusVisible = !!emojiCode && isOneOnOneChat(!isEmptyObject(report) ? report : undefined);

    const subscriptAvatarBorderColor = isFocused ? focusedBackgroundColor : theme.sidebar;
    const firstIcon = optionItem.icons?.at(0);

    const onOptionPress = (event: GestureResponderEvent | KeyboardEvent | undefined) => {
        Performance.markStart(CONST.TIMING.OPEN_REPORT);
        Timing.start(CONST.TIMING.OPEN_REPORT);

        event?.preventDefault();
        // Enable Composer to focus on clicking the same chat after opening the context menu.
        ReportActionComposeFocusManager.focus();
        hideProductTrainingTooltip();
        onSelectRow(optionItem, popoverAnchor);
    };

    return (
        <OfflineWithFeedback
            pendingAction={optionItem.pendingAction}
            errors={optionItem.allReportErrors}
            shouldShowErrorMessages={false}
            needsOffscreenAlphaCompositing
        >
            <EducationalTooltip
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                shouldRender={shouldShowProductTrainingTooltip}
                renderTooltipContent={renderProductTrainingTooltip}
                anchorAlignment={{
                    horizontal: shouldShowWorkspaceChatTooltip ? CONST.MODAL.ANCHOR_ORIGIN_HORIZONTAL.LEFT : CONST.MODAL.ANCHOR_ORIGIN_HORIZONTAL.RIGHT,
                    vertical: CONST.MODAL.ANCHOR_ORIGIN_VERTICAL.TOP,
                }}
                shiftHorizontal={shouldShowWorkspaceChatTooltip ? variables.workspaceLHNTooltipShiftHorizontal : variables.gbrTooltipShiftHorizontal}
                shiftVertical={shouldShowWorkspaceChatTooltip ? 0 : variables.gbrTooltipShiftVertical}
                wrapperStyle={styles.productTrainingTooltipWrapper}
                onTooltipPress={onOptionPress}
                shouldHideOnScroll
            >
                <View>
                    <Hoverable>
                        {(hovered) => (
                            <PressableWithSecondaryInteraction
                                ref={popoverAnchor}
                                onPress={onOptionPress}
                                onMouseDown={(event) => {
                                    // Allow composer blur on right click
                                    if (!event) {
                                        return;
                                    }
                                    // Prevent composer blur on left click
                                    event.preventDefault();
                                }}
                                // reportID may be a number contrary to the type definition
                                testID={typeof optionItem.reportID === 'number' ? String(optionItem.reportID) : optionItem.reportID}
                                onSecondaryInteraction={(event) => {
                                    showPopover(event);
                                    // Ensure that we blur the composer when opening context menu, so that only one component is focused at a time
                                    if (DomUtils.getActiveElement()) {
                                        (DomUtils.getActiveElement() as HTMLElement | null)?.blur();
                                    }
                                }}
                                withoutFocusOnSecondaryInteraction
                                activeOpacity={variables.pressDimValue}
                                opacityAnimationDuration={0}
                                style={[
                                    styles.flexRow,
                                    styles.alignItemsCenter,
                                    styles.justifyContentBetween,
                                    styles.sidebarLink,
                                    styles.sidebarLinkInnerLHN,
                                    StyleUtils.getBackgroundColorStyle(theme.sidebar),
                                    isFocused ? styles.sidebarLinkActive : null,
                                    (hovered || isContextMenuActive) && !isFocused ? styles.sidebarLinkHover : null,
                                ]}
                                role={CONST.ROLE.BUTTON}
                                accessibilityLabel={`${translate('accessibilityHints.navigatesToChat')} ${optionItem.text}. ${optionItem.isUnread ? `${translate('common.unread')}.` : ''} ${
                                    optionItem.alternateText
                                }`}
                                onLayout={onLayout}
                                needsOffscreenAlphaCompositing={(optionItem?.icons?.length ?? 0) >= 2}
                            >
                                <View style={sidebarInnerRowStyle}>
                                    <View style={[styles.flexRow, styles.alignItemsCenter]}>
                                        {!!optionItem.icons?.length &&
                                            firstIcon &&
                                            (optionItem.shouldShowSubscript ? (
                                                <SubscriptAvatar
                                                    backgroundColor={hovered && !isFocused ? hoveredBackgroundColor : subscriptAvatarBorderColor}
                                                    mainAvatar={firstIcon}
                                                    secondaryAvatar={optionItem.icons.at(1)}
                                                    size={isInFocusMode ? CONST.AVATAR_SIZE.SMALL : CONST.AVATAR_SIZE.DEFAULT}
                                                />
                                            ) : (
                                                <MultipleAvatars
                                                    icons={optionItem.icons}
                                                    isFocusMode={isInFocusMode}
                                                    size={isInFocusMode ? CONST.AVATAR_SIZE.SMALL : CONST.AVATAR_SIZE.DEFAULT}
                                                    secondAvatarStyle={[
                                                        StyleUtils.getBackgroundAndBorderStyle(theme.sidebar),
                                                        isFocused ? StyleUtils.getBackgroundAndBorderStyle(focusedBackgroundColor) : undefined,
                                                        hovered && !isFocused ? StyleUtils.getBackgroundAndBorderStyle(hoveredBackgroundColor) : undefined,
                                                    ]}
                                                    shouldShowTooltip={shouldOptionShowTooltip(optionItem)}
                                                />
                                            ))}
                                        <View style={contentContainerStyles}>
                                            <View style={[styles.flexRow, styles.alignItemsCenter, styles.mw100, styles.overflowHidden]}>
                                                <DisplayNames
                                                    accessibilityLabel={translate('accessibilityHints.chatUserDisplayNames')}
                                                    fullTitle={optionItem.text ?? ''}
                                                    displayNamesWithTooltips={optionItem.displayNamesWithTooltips ?? []}
                                                    tooltipEnabled
                                                    numberOfLines={1}
                                                    textStyles={displayNameStyle}
                                                    shouldUseFullTitle={
                                                        !!optionItem.isChatRoom ||
                                                        !!optionItem.isPolicyExpenseChat ||
                                                        !!optionItem.isTaskReport ||
                                                        !!optionItem.isThread ||
                                                        !!optionItem.isMoneyRequestReport ||
                                                        !!optionItem.isInvoiceReport ||
                                                        isGroupChat(report) ||
                                                        isSystemChat(report)
                                                    }
                                                />
                                                {isChatUsedForOnboarding && <FreeTrial badgeStyles={[styles.mnh0, styles.pl2, styles.pr2, styles.ml1]} />}
                                                {isStatusVisible && (
                                                    <Tooltip
                                                        text={statusContent}
                                                        shiftVertical={-4}
                                                    >
                                                        <Text style={styles.ml1}>{emojiCode}</Text>
                                                    </Tooltip>
                                                )}
                                            </View>
                                            {optionItem.alternateText ? (
                                                <Text
                                                    style={alternateTextStyle}
                                                    numberOfLines={1}
                                                    accessibilityLabel={translate('accessibilityHints.lastChatMessagePreview')}
                                                >
                                                    {Parser.htmlToText(optionItem.alternateText)}
                                                </Text>
                                            ) : null}
                                        </View>
                                        {optionItem?.descriptiveText ? (
                                            <View style={[styles.flexWrap]}>
                                                <Text style={[styles.textLabel]}>{optionItem.descriptiveText}</Text>
                                            </View>
                                        ) : null}
                                        {hasBrickError && (
                                            <View style={[styles.alignItemsCenter, styles.justifyContentCenter]}>
                                                <Icon
                                                    testID="RBR Icon"
                                                    src={Expensicons.DotIndicator}
                                                    fill={theme.danger}
                                                />
                                            </View>
                                        )}
                                    </View>
                                </View>
                                <View
                                    style={[styles.flexRow, styles.alignItemsCenter]}
                                    accessible={false}
                                >
                                    {shouldShowGreenDotIndicator && (
                                        <View style={styles.ml2}>
                                            <Icon
                                                testID="GBR Icon"
                                                src={Expensicons.DotIndicator}
                                                fill={theme.success}
                                            />
                                        </View>
                                    )}
                                    {hasDraftComment && !!optionItem.isAllowedToComment && (
                                        <View
                                            style={styles.ml2}
                                            accessibilityLabel={translate('sidebarScreen.draftedMessage')}
                                        >
                                            <Icon
                                                testID="Pencil Icon"
                                                fill={theme.icon}
                                                src={Expensicons.Pencil}
                                            />
                                        </View>
                                    )}
                                    {!shouldShowGreenDotIndicator && !hasBrickError && !!optionItem.isPinned && (
                                        <View
                                            style={styles.ml2}
                                            accessibilityLabel={translate('sidebarScreen.chatPinned')}
                                        >
                                            <Icon
                                                testID="Pin Icon"
                                                fill={theme.icon}
                                                src={Expensicons.Pin}
                                            />
                                        </View>
                                    )}
                                </View>
                            </PressableWithSecondaryInteraction>
                        )}
                    </Hoverable>
                </View>
            </EducationalTooltip>
        </OfflineWithFeedback>
    );
}

OptionRowLHN.displayName = 'OptionRowLHN';

export default React.memo(OptionRowLHN);
