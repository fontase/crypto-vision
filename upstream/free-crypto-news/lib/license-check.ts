/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

/**
 * @copyright Copyright (c) 2024-2026 Nicholas (nirholas)
 * @author Nicholas <nirholas@users.noreply.github.com>
 * @license See LICENSE file for licensing details
 *
 * Crypto Data Aggregator - Dual Licensed
 * Free for non-commercial use, commercial license required for business use.
 */

/**
 * License information for Crypto Data Aggregator
 */
export const LICENSE_INFO = {
  owner: 'Nicholas (nirholas)',
  copyright: '2024-2026',
  contact: 'nirholas@users.noreply.github.com',
  github: 'https://github.com/nirholas',
  license: 'Dual License - Free for non-commercial use',
};

/**
 * Shows license info in console on first load
 */
export function showLicenseInfo(): void {
  if (typeof window !== 'undefined') {
    console.log(
      '%c🚀 Crypto Data Aggregator',
      'color: #10b981; font-size: 16px; font-weight: bold;'
    );
    console.log('%c© 2024-2026 Nicholas (nirholas)', 'color: #6b7280; font-size: 11px;');
    console.log(
      '%cFree for non-commercial use. Commercial license: nirholas@users.noreply.github.com',
      'color: #6b7280; font-size: 10px;'
    );
  }
}
