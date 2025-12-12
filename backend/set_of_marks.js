/**
 * Ghost Pilot: Set-of-Marks JavaScript Injection
 * 
 * This script overlays numbered yellow tags on all interactive elements.
 * It returns a mapping of tag IDs to DOM elements for Playwright targeting.
 */

(function () {
    // Remove any existing tags from previous runs
    const existingContainer = document.getElementById('ghost-pilot-tags');
    if (existingContainer) {
        existingContainer.remove();
    }

    // Selectors for interactive elements
    const INTERACTIVE_SELECTORS = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'textarea',
        'select',
        '[onclick]',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[contenteditable="true"]',
        'label[for]',
        '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    /**
     * Check if an element is actually visible to the user
     */
    function isVisible(element) {
        if (!element || !element.offsetParent) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (parseFloat(style.opacity) === 0) return false;

        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        // Check if element is in viewport
        if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
        if (rect.right < 0 || rect.left > window.innerWidth) return false;

        return true;
    }

    /**
     * Get center coordinates of an element
     */
    function getCenter(rect) {
        return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
        };
    }

    // Find all interactive elements
    const allElements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS));
    const visibleElements = allElements.filter(isVisible);

    // Create container for tags
    const tagContainer = document.createElement('div');
    tagContainer.id = 'ghost-pilot-tags';
    tagContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
    font-family: 'Courier New', monospace;
  `;

    // Create element map to return to Python
    const elementMap = {};

    // Tag each visible element
    visibleElements.forEach((element, index) => {
        const tagId = index + 1;
        const rect = element.getBoundingClientRect();
        const center = getCenter(rect);

        // Create tag overlay
        const tag = document.createElement('div');
        tag.className = 'ghost-pilot-tag';
        tag.style.cssText = `
      position: absolute;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid #FFD700;
      background: rgba(255, 215, 0, 0.15);
      box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
      pointer-events: none;
      box-sizing: border-box;
      transition: all 0.2s ease;
    `;

        // Create number label
        const label = document.createElement('div');
        label.style.cssText = `
      position: absolute;
      top: -12px;
      left: -3px;
      background: #FFD700;
      color: #000;
      padding: 2px 8px;
      font-size: 14px;
      font-weight: bold;
      border-radius: 3px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      line-height: 1;
      min-width: 20px;
      text-align: center;
    `;
        label.textContent = tagId;

        tag.appendChild(label);
        tagContainer.appendChild(tag);

        // Store in map
        elementMap[tagId] = {
            element: element,
            selector: getUniqueSelector(element),
            tagName: element.tagName.toLowerCase(),
            type: element.type || null,
            text: element.textContent?.trim().substring(0, 100) || '',
            placeholder: element.placeholder || '',
            ariaLabel: element.getAttribute('aria-label') || '',
            rect: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            },
            center: center
        };
    });

    // Append tags to body
    document.body.appendChild(tagContainer);

    /**
     * Generate a unique CSS selector for an element
     */
    function getUniqueSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }

        if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(' ').filter(c => c && !c.includes('ghost-pilot'));
            if (classes.length > 0) {
                const selector = `${element.tagName.toLowerCase()}.${classes.join('.')}`;
                if (document.querySelectorAll(selector).length === 1) {
                    return selector;
                }
            }
        }

        // Build path from root
        const path = [];
        let current = element;
        while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                selector = `#${current.id}`;
                path.unshift(selector);
                break;
            }

            // Add nth-child if needed
            let sibling = current;
            let nth = 1;
            while (sibling.previousElementSibling) {
                sibling = sibling.previousElementSibling;
                if (sibling.tagName === current.tagName) nth++;
            }

            const siblings = Array.from(current.parentNode?.children || [])
                .filter(el => el.tagName === current.tagName);

            if (siblings.length > 1) {
                selector += `:nth-child(${nth})`;
            }

            path.unshift(selector);
            current = current.parentElement;
        }

        return path.join(' > ');
    }

    // Return serializable data (without DOM references)
    const serializableMap = {};
    Object.keys(elementMap).forEach(key => {
        const data = elementMap[key];
        serializableMap[key] = {
            selector: data.selector,
            tagName: data.tagName,
            type: data.type,
            text: data.text,
            placeholder: data.placeholder,
            ariaLabel: data.ariaLabel,
            rect: data.rect,
            center: data.center
        };
    });

    return {
        tagCount: visibleElements.length,
        elements: serializableMap,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY
        }
    };
})();
