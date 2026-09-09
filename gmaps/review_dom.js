() => {
			try {
				const reviews = [];
                const cache = window.__axiocredReviewCards ??= new WeakMap();

				// Try multiple selectors for review container elements
				// Google Maps uses various class names that change over time
				const reviewSelectors = [
					'.jftiEf',                           // Common review container
					'div[data-review-id]',               // Review with ID attribute
					'.gws-localreviews__google-review',  // Alternative format
					'[data-hveid] .review-dialog-list > div', // Search results reviews
					'.WMbnJf',                           // Another review container
					'.bwb7ce',                           // New review format
				];

				let reviewElements = [];
				for (const selector of reviewSelectors) {
					const elements = document.querySelectorAll(selector);
					if (elements && elements.length > 0) {
						reviewElements = Array.from(elements);
						console.log('Found reviews with selector:', selector, 'count:', elements.length);
						break;
					}
				}

				// If no reviews found with specific selectors, try to find by structure
				if (reviewElements.length === 0) {
					// Look for elements that look like reviews (have rating + text)
					const allDivs = document.querySelectorAll('div[class]');
					for (const div of allDivs) {
						const hasRating = div.querySelector('[aria-label*="star"], [role="img"][aria-label*="star"]');
						const hasText = div.querySelector('span.wiI7pd, span[class*="review"]');
						if (hasRating && hasText && !reviewElements.includes(div)) {
							reviewElements.push(div);
						}
					}
				}

				console.log('Total review elements found:', reviewElements.length);

				for (const element of reviewElements) {
					try {
						const fingerprint = element.innerHTML;
                        if (cache.get(element) === fingerprint) continue;
                        cache.set(element, fingerprint);
                        // The card carries the id, unless the selector matched a wrapper
						const reviewId = element.getAttribute('data-review-id') ||
							element.querySelector('[data-review-id]')?.getAttribute('data-review-id') || '';

						// Author name - comprehensive selectors
						const userSelectors = [
							'.d4r55',           // Primary name class
							'.WNxzHc',          // Alternative name
							'.TSUbDb a',        // Link with name
							'.review-author',   // Generic
							'button.al6Kxe',    // Clickable name
							'.bHrnEe',          // Another name container
						];
						let userName = '';
						let userUrl = '';
						for (const sel of userSelectors) {
							const el = element.querySelector(sel);
							if (el) {
								userName = el.textContent?.trim() || '';
								if (el.tagName?.toLowerCase() === 'a') {
									userUrl = el.getAttribute('href') || '';
								}
								if (userName) break;
							}
						}

						userUrl ||= element.querySelector('a[href*="/maps/contrib/"]')?.getAttribute('href') || element.querySelector('[data-href*="/maps/contrib/"]')?.getAttribute('data-href') || '';
                        const publishedAt = element.querySelector('time[datetime]')?.getAttribute('datetime') || '';
                        const replyText = element.querySelector('.CDe7pd .wiI7pd, .review-owner-response')?.textContent?.trim() || '';
                        // Profile picture - multiple patterns
						const profilePicSelectors = [
							'.NBa7we',
							'img[src*="googleusercontent"]',
							'img[src*="lh3.google"]',
							'.review-author-photo img',
						];
						let profilePic = '';
						for (const sel of profilePicSelectors) {
							const el = element.querySelector(sel);
							if (el) {
								profilePic = el.getAttribute('src') || '';
								if (profilePic) break;
							}
						}

						// Rating - try multiple approaches
						let rating = 0;
						const ratingSelectors = [
							'.kvMYJc',
							'.DU9Pgb span[aria-label]',
							'[role="img"][aria-label*="star"]',
							'.pjemBf span',
							'.review-score',
						];
						for (const sel of ratingSelectors) {
							const ratingEl = element.querySelector(sel);
							if (ratingEl) {
								const ariaLabel = ratingEl.getAttribute('aria-label') || '';
								// Match patterns like "5 stars", "Rated 4 out of 5", "4.5 étoiles"
								const match = ariaLabel.match(/(\d+(?:\.\d+)?)/);
								if (match) {
									rating = Math.round(parseFloat(match[1])) || 0;
									break;
								}
								// Also try counting filled stars
								const filledStars = element.querySelectorAll('.hCCjke.vzX5Ic, [aria-label*="star"][style*="color"]').length;
								if (filledStars > 0) {
									rating = filledStars;
									break;
								}
							}
						}

						// Time/date - multiple selectors
						const timeSelectors = ['.rsqaWe', '.DU9Pgb', '.tTVLSc', '.review-date', '.dehysf'];
						let relativeTime = '';
						for (const sel of timeSelectors) {
							const el = element.querySelector(sel);
							if (el) {
								const text = el.textContent?.trim() || '';
								// Look for time-related text (ago, month, year, etc)
								if (text && (text.includes('ago') || text.includes('week') || text.includes('month') ||
								    text.includes('year') || text.includes('day') || text.match(/\d{4}/))) {
									relativeTime = text;
									break;
								}
							}
						}

						// Review text - try to expand and get full text
						const textSelectors = [
							'.MyEned .wiI7pd',
                            '.wiI7pd',
							'.MyEned span',
							'.review-full-text',
							'.Jtu6Td span',
							'[data-expandable-section] span',
						];
						let text = '';

						// First try to click "More" button to expand text
						const moreButtons = element.querySelectorAll('button.w8nwRe, button[jsaction*="expandReview"]');
						for (const btn of moreButtons) {
							try { btn.click(); } catch(e) {}
						}

						for (const sel of textSelectors) {
							const textEl = [...element.querySelectorAll(sel)].find(node => !node.closest('.CDe7pd, .review-owner-response'));
							if (textEl) {
								text = textEl.textContent?.trim() || '';
								if (text && text.length > 5) break;
							}
						}

						// Images
						const imageElements = element.querySelectorAll('.KtCyie img, .Tya61d img, .review-photos img');
						const images = [];
						for (const img of imageElements) {
							const src = img.getAttribute('src') || '';
							if (src && !src.includes('data:image') && !src.includes('profile')) {
								images.push(src);
							}
						}

						if ((userName || reviewId) && (text || rating > 0)) {
							reviews.push({
								review_id: reviewId,
								author_name: userName,
								author_url: userUrl,
								profile_picture: profilePic,
                                published_at: publishedAt,
                                reply_text: replyText,
								rating: rating,
								relative_time_description: relativeTime,
								text: text,
								images: images
							});
						}
					} catch (e) {
						console.error("Error extracting review:", e);
					}
				}

				return reviews;
			} catch (e) {
				console.error("Error in review extraction:", e);
				return [];
			}
		}
