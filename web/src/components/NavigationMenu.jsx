import { NavigationMenu as BaseNavigationMenu } from '@base-ui/react';
import { navigationMenuTriggerStyle } from './navigation-menu-styles.js';
import { forwardRef } from 'react';

const NavigationMenu = forwardRef(function NavigationMenu(
  { children, className, viewport = true, ...props },
  ref
) {
  return (
    <BaseNavigationMenu.Root
      ref={ref}
      data-slot="navigation-menu"
      className={['navigation-menu', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
      {viewport && <BaseNavigationMenu.Viewport data-slot="navigation-menu-viewport" />}
    </BaseNavigationMenu.Root>
  );
});

const NavigationMenuList = forwardRef(function NavigationMenuList(
  { className, ...props },
  ref
) {
  return (
    <BaseNavigationMenu.List
      ref={ref}
      data-slot="navigation-menu-list"
      className={['navigation-menu-list', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

const NavigationMenuItem = BaseNavigationMenu.Item;

const NavigationMenuTrigger = forwardRef(function NavigationMenuTrigger(
  { className, children, ...props },
  ref
) {
  return (
    <BaseNavigationMenu.Trigger
      ref={ref}
      data-slot="navigation-menu-trigger"
      className={['navigation-menu-trigger', navigationMenuTriggerStyle(), className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </BaseNavigationMenu.Trigger>
  );
});

const NavigationMenuContent = forwardRef(function NavigationMenuContent(
  { className, children, ...props },
  ref
) {
  return (
    <BaseNavigationMenu.Content
      ref={ref}
      data-slot="navigation-menu-content"
      className={['navigation-menu-content', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </BaseNavigationMenu.Content>
  );
});

const NavigationMenuLink = forwardRef(function NavigationMenuLink(
  { className, ...props },
  ref
) {
  return (
    <BaseNavigationMenu.Link
      ref={ref}
      data-slot="navigation-menu-link"
      className={['navigation-menu-link', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
};
