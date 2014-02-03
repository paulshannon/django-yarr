/** ++ In development ++
*/

$(function () {
    var Yarr = window.YARR;
    if (!Yarr) {
        return;
    }
    
    /**************************************************************************
    **                                                          Declare vars
    */
    
    var $con = Yarr.$con;
    
    var 
        /*
        ** Internal vars
        */
        OP_READ = 'read',
        OP_SAVED = 'saved',
        MODE_EXPANDED = 'expanded',
        MODE_LIST = 'list',
        FEEDS_VISIBLE = 'visible',
        FEEDS_HIDDEN = 'hidden',
        
        apiEntrySet = $con.data('api-entry-set'),
        
        $controlFixed, controlIsFixed = false,
        controlTop, controlHeight, controlBottom,
        scrollCutoff, entryBottoms, entryMargin,
        
        
        /*
        ** Settings
        */
        
        // Switch items when scrolling past this point
        scrollSwitchMargin = 100,
        
        // Load more entries for infinite scroll when this many pixels left
        scrollInfiniteMargin = 300,
        
        options = {
            // Display mode; one of:
            //      expanded    Traditional list of titles and bodies
            //      list        List of titles, with expanding bodies
            displayMode: Yarr.Cookie.get('yarr-displayMode', MODE_EXPANDED),
        
            // Whether or not the control bar and feed list should be fixed
            layoutFixed: !!$con.data('layout-fixed'),
            
            // Feed list visiblity; either visible or hidden, or null for CSS
            feedListShow: Yarr.Cookie.get('yarr-feedListShow', null),
            
            // Number of entries on a page
            pageLength: $con.data('api-page-length'),
            
            // List of available pks
            pkAvailable: String($con.data('available-pks'))
        }
    ;
    
    
    /** Layout
        Manages control bar, feed bar, layout and trigger infinite scrolling
    */
    function Layout(options, $scroller) {
        /** Initialise the layout
            Pass the scroll container
        */
        this.$scroller = $scroller || $(window);
        var $base = $scroller || $('body');
        
        // Set options
        this.options = options;
        this.displayMode = options.displayMode;
        this.layoutFixed = options.layoutFixed;
        this.feedListShow = options.feedListShow;
        
        // Find elements
        this.$control = $base.find('.yarr_control');
        this.$content = $base.find('.yarr_content');
        this.$feedList = $base.find('.yarr_feed_list');
        
        // Initialise related classes
        this.entries = new EntryManager(this, $base.find('.yarr_entry'));
        
        // Set up control bar and fixed layout
        this.setupControl();
        if (this.layoutFixed) {
            this.fixLayout();
        }
        this.$scroller
            .resize(function () { thisLayout.onResize(); })
            .scroll(function () { thisLayout.onScroll(); })
        ;
        this.onResize();
    }
    Layout.prototype = $.extend(Layout.prototype, {
        // Settings from options
        options: null,
        displayMode: MODE_EXPANDED,
        layoutFixed: true,
        feedListShow: null,
        
        setupControl: function () {
            /** Remove pagination links, add scroll buttons */
            
            // Adds infinite scroll support, so disable pagination links
            this.$control.find('.yarr_paginated').remove();
            
            // Add mode switch and initialise
            var thisLayout = this;
            this.modeButton = this._mkButton(
                'Mode',
                function () {
                    thisLayout.switchMode(
                        (thisLayout.displayMode == MODE_LIST)
                        ? MODE_EXPANDED : MODE_LIST
                    );
                }
            );
            $('<ul class="yarr_menu_mode" />')
                .append($('<li/>').append(this.modeButton))
                .insertAfter(this.$control.find('.yarr_menu_op'))
            ;
            this.switchMode(this.displayMode);
            
            // Add next/prev buttons
            $('<ul class="yarr_nav"/>')
                .append($('<li/>').append(
                    this._mkIconButton('yarr_previous', function () {
                        return thisLayout.selectPrevious();
                    })
                ))
                .append(' ')
                .append($('<li/>').append(
                    this._mkIconButton('yarr_next', function () {
                        return thisLayout.selectNext();
                    })
                ))
                .appendTo(this.$control)
            ;
            
            // Calculate entry margin for autoscrolling
            this.controlBottom = this.$control.offset().top + this.$control.outerHeight();
            this.entryMargin = this.$feedList.offset().top - this.controlBottom;
        },
        fixLayout: function () {
            /** Prepare fixed layout */
            
            // Add feed switch and initialise
            var thisLayout = this;
            $('<ul class="yarr_menu_feed"/ >')
                .append($('<li/>').append(
                    this._mkButton('Feeds', function () {
                        thisLayout.toggleFeed();
                    })
                ))
                .insertBefore(this.$control.find('.yarr_menu_filter'))
            ;
            
            // Clone control bar ready for fixed position
            // Need to clone so the original can stay in position
            this.$controlFixed = this.$control
                .clone(true)
                .insertAfter(this.$control)
                .css({
                    'position': 'fixed',
                    'top':      0
                })
                .hide()
            ;
            
            // Prepare the fixed feedList
            this.$feedList.css({
                'top':      this.controlBottom,
                'bottom':   this.$feedList.css('margin-top'),
            });
            
            // Toggle the feed list visibility, if preference in cookies
            if (this.feedListShow) {
                this.toggleFeed(this.feedListShow);
            }
        },
        switchMode: function (newMode) {
            /** Switch display mode between expanded and list view */
            
            // Switch the mode
            if (newMode == MODE_LIST) {
                this.$content.addClass('yarr_mode_list');
                this.modeButton.text('Expanded view');
            } else {
                this.$content.removeClass('yarr_mode_list');
                this.modeButton.text('List view');
            }
            
            // Update var and cookie
            this.displayMode = newMode;
            Yarr.Cookie.set('yarr-displayMode', newMode);
            
            // Scroll to the top
            this.$scroller.scrollTop(0);
            
            // Ensure full screen
            this.ensureFullScreen();
        },
        
        toggleFeed: function(to) {
            /** Toggle the visibility of the feed
                Only available if layoutFixed
            */
            // Current state is determined by checking for element visibility
            // This allows the CSS to decide the default status with media rules
            var thisLayout = this,
                speed = 'fast',
                isOpen = this.$feedList.is(":visible"),
                
                // Add dummy element to get true CSS values
                $dummyList = $('<div class="yarr_feed_list">&nbsp;</div>')
            ;
            
            // Check if the switch isn't needed
            if ((to == FEEDS_VISIBLE && isOpen)
                || (to == FEEDS_HIDDEN && !isOpen)
            ) {
                return;
            }
            
            // Special action for mobile layout
            if ($dummyList.css('position') == 'relative') {
                if (isOpen) {
                    this.$feedList.slideUp(speed, function () {
                        this.$feedList.removeAttr('style');
                    });
                } else {
                    this.$feedList.slideDown(speed);
                }
                return;
            }
            
            // Normal sidebar layout
            if (isOpen) {
                this.$feedList.animate({'width': 0}, speed, function () {
                    thisLayout.$feedList.hide();
                });
                this.$content.animate({'margin-left': 0}, speed);
                
            } else {
                var $dummyContent = $('<div class="yarr_content">&nbsp;</div>');
                
                this.$feedList
                    .show()
                    .animate({'width': $dummyList.width()}, function () {
                        thisLayout.$feedList.removeAttr('style');
                    })
                ;
                this.$content
                    .animate(
                        {'margin-left': $dummyContent.css('margin-left')},
                        function () {
                            thisLayout.$content.removeAttr('style');
                        }
                    );
            }
            
            // Save the current display configuration in a cookie
            // This will disable initial auto-sensing between screen sizes,
            this.feedListShow = isOpen ? FEEDS_HIDDEN : FEEDS_VISIBLE;
            Yarr.Cookie.set('yarr-feedListShow', this.feedListShow);
        },
        
        ensureFullScreen: function() {
            /** Ensure that enough entries have loaded to fill the screen, if more
                are available.
                
                Infinite scroll can't trigger without a full screen to scroll.
            */
            
            // Only in list mode
            if (this.displayMode != MODE_LIST) {
                return;
            }
            
            // Get the height from the bottom of the loaded entries to the bottom
            // of the viewport, plus the infinite scroll margin
            var gap = (
                (this.$scroller.innerHeight() + scrollInfiniteMargin)
                - (this.$content.offset().top + this.$content.outerHeight())
            );
            
            // If there's a gap, tell Entries to load enough entries to exceed
            // the infinite scroll margin, by finding height of one entry
            this.entries.loadInfiniteScroll(
                Math.ceil(gap / this.entries.entries[0].$el.outerHeight())
            );
            
            this.entries.loadInfiniteScroll(
            
            );
        },
        
        updateScrollTrigger: function () {
            this.scrollInfiniteTrigger = this.$content.outerHeight()
                + this.$content.position().top
                - this.$scroller.innerHeight() - scrollInfiniteMargin
            ;
        },
        
        scrollTo: function (y) {
            /** Scroll the container to the given offset */
            this.$scroller.scrollTop(
                (y - this.$control.outerHeight()) - this.entryMargin
            );
        },
        
        

        onResize: function () {
            /** Event handler for when the scroller resizes
                Updates the fixed control bar position, and calls entriesResized
            */
            // Get position of $control
            var controlOffset = this.$control.offset();
            
            // Find position of controlTop and scrollCutoff (may have changed)
            controlTop = controlOffset.top;
            controlHeight = this.$control.outerHeight();
            scrollCutoff = controlHeight + scrollSwitchMargin;
            
            // Move $controlFixed to occupy same horizontal position as $control
            if (this.layoutFixed) {
                this.$controlFixed.css({
                    left:   controlOffset.left,
                    width:  this.$control.width()
                });
            }
            
            // The entries will have resized
            this.entries.entriesResized();
            this.ensureFullScreen();
        },
    
        onScroll: function () {
            /** Event handler for scrolling */
            var scrollTop = this.$scroller.scrollTop(),
                newCurrent = -1,
                topCutoff = scrollTop + scrollCutoff,
                topMoved = false
            ;
            
            // Switch control bar between fixed and relative position
            if (this.layoutFixed) {
                if (scrollTop > controlTop) {
                    // Fixed layout
                    // Only change if changed
                    if (!controlIsFixed) {
                        // Switch control bar to fixed position
                        this.$controlFixed.show();
                        controlIsFixed = true;
                        
                        // Move feed list to bottom of fixed bar
                        this.$feedList.css('top', this.$controlFixed.outerHeight());
                    }
                    
                } else {
                    // Relative layout
                    // Only switch bars if changed
                    if (controlIsFixed) {
                        // Switch control bar to relative position
                        this.$controlFixed.hide();
                        controlIsFixed = false;
                    }
                    
                    // Always move feed list to bottom of relative bar
                    this.$feedList.css('top', controlBottom - scrollTop);
                }
            }
            
            // Update selection if in expanded mode
            if (this.displayMode == MODE_EXPANDED) {
                // ++ Move this into entries
                for (var i=0, l=this.entries.entries.length; i<l; i++) {
                    if (entryBottoms[i] > topCutoff) {
                        newCurrent = i;
                        break;
                    }
                }
                if (newCurrent >= 0 && newCurrent != this.entries.current) {
                    this.entries.selectEntry(newCurrent);
                }
            }
            
            // Infinite scroll
            if (scrollTop > this.scrollInfiniteTrigger) {
                this.entries.loadInfiniteScroll();
            }
        },
    
        
        
        /* Internal util functions */
        _mkButton: function (txt, fn) {
            return $('<a href="#" class="button">' + txt + '</a>')
                .click(function (e) {
                    e.preventDefault();
                    fn();
                })
            ;
        },
        _mkIconButton: function (className, fn) {
            return $('<a href="#" class="' + className + '">&nbsp;</a>')
                .click(function (e) {
                    e.preventDefault();
                    fn();
                })
            ;
        }
       
    });
    
    function Entries(layout, $el) {
        this.layout = layout;
        this.$entries = $el;
        this.pkLookup = {};
        
        // Options
        this.pageLength = layout.options.pageLength;
        this.pkAvailable = layout.options.pkAvailable;
        
        // Split pkAvailable
        if (!this.pkAvailable) {
            this.pkAvailable = [];
        } else {
            this.pkAvailable = this.pkAvailable.split(',');
        }
        
        // Initialise Entry classes
        this.entries = [];
        for (var i=0, l=$el.length; i<l; i++) {
            this.entries[i] = new Entry(this, $($el[i]));
        }
    }
    
    Entries.prototype = $.extend(Entries.prototype, {
        // Page length for API requests
        pageLength: null,
        pkAvailable: null,
        
        loading: false,
        finished: false,
        pkLookup: null,
        pkLast: 0,
        
        current: null,
        $current: null,
        
        loadInfiniteScroll: function (loadNumber) {
            /** Infinite scroll loader
                Called when it is time to load more entries
            */
            var thisEntries = this;
            
            // Don't do anything if:
            //  * there are no entries at all,
            //  * we're already trying to load more, or
            //  * there is no more to load
            if (this.entries.length === 0 || this.loading || this.finished) {
                return;
            }
            this.loading = true;
            
            // Build list of visible PKs
            var $entry, i, len = this.entries.length;
            for (i=this.pkLast; i<len; i++) {
                $entry = $(this.entries[i].$el);
                this.pkLookup[$entry.data('yarr-pk')] = $entry;
            }
            this.pkLast = this.entries.length;
            
            // Default loadNumber to pageLength - may be higher in list mode
            if (!loadNumber) {
                loadNumber = this.pageLength;
            }
            
            // Decide which pks to get next
            // ++ can be smarter here - use pkUnloaded
            var pkRequest = [];
            len = this.pkAvailable.length;
            for (i=0; i<len && pkRequest.length<loadNumber; i++) {
                if (!pkLookup[this.pkAvailable[i]]) {
                    pkRequest.push(this.pkAvailable[i]);
                }
            }
            
            if (pkRequest.length == 0) {
                Yarr.Status.set('No more entries to load');
                this.loading = false;
                this.finished = true;
                return;
            }
            
            // Get data for entries
            Yarr.Status.set('Loading...');
            Yarr.API.get_entries(
                pkRequest,
                function (entries) {
                    /** Entries loaded */
                    thisEntries.loading = false;
                    
                    // Catch no more entries
                    var count = entries.length;
                    if (count == 0) {
                        Yarr.Status.set('No more entries to load');
                        thisEntries.finished = true;
                        return;
                    }
                    
                    // Add HTML of entries
                    var $entries = [];
                    for (var i=0; i<count; i++) {
                        var $entry = $(entries[i].html).appendTo(thisEntries.layout.$content);
                        thisEntries.entries.push(new Entry(thisEntries, $entry));
                        $entries.push($entry);
                    }
                    
                    // Update $entries and recalc size
                    thisEntries.$entries.add($entries);
                    thisEntries.entriesResized();
                }, function () {
                    /** API list load: failure */
                    thisEntries.loading = false;
                }
            );
        },
        
        entriesResized: function () {
            /** Recalculate cached positions which depend on entry height
                Called when the entries have resized
            */
            
            // Cache the entry positions
            entryBottoms = [];
            var $el;
            for (var i=0, l=this.entries.length; i<l; i++) {
                $el = this.entries[i].$el;
                entryBottoms[i] = $el.offset().top + $el.outerHeight();
            }
            
            // Update the infinite scroll trigger
            this.layout.updateScrollTrigger();
        },
        
        selectEntry: function (index) {
            /** Select an entry */
            // Deselect current
            if (this.current !== null) {
                this.entries[this.current].$el.removeClass('yarr_active');
            }
            
            // Update current and get flag fields
            this.current = index;
            this.$current = this.entries[this.current].$el
                .addClass('yarr_active')
            ;
            
            // Open the selected item
            this.openCurrent();
            
            // If this is the last entry, try to load more
            if (index == this.entries.length - 1) {
                this.loadInfiniteScroll();
            }
        },
        selectNext: function () {
            /** Select the next (or first) entry */
            if (this.current === null) {
                this.current = -1;
            }
            if (this.current == this.entries.length - 1) {
                return;
            }
            this.selectEntry(this.current + 1);
            this.scrollCurrent();
        },
        
        selectPrevious: function () {
            /** Select previous, unless none or index 0 selected */
            if (!this.current) {
                return;
            }
            this.selectEntry(this.current - 1);
            this.scrollCurrent();
        },

        scrollCurrent: function () {
            /** Scroll to the current entry */
            this.layout.scrollTo(this.entries[this.current].$el.offset().top);
        },
        
        openCurrent: function () {
            /** Open the specified entry, marking it as read */
            var $read = this.$current.find('input[name="read"]'),
                $saved = this.$current.find('input[name="saved"]')
            ;
            if (!$saved.prop('checked') && !$read.prop('checked')) {
                $read
                    .prop('checked', true)
                    .change()
                ;
            }
            
            if (this.layout.displayMode == MODE_LIST) {
                this.$entries.removeClass('yarr_open');
                this.$current.addClass('yarr_open');
                this.entriesResized();
            }
        },

        clickCurrent: function () {
            /** Clicks the link of the current entry to open it in a new tab */
            if (this.current === null) {
                return;
            }
            if (!this.$current.hasClass('yarr_active')) {
                return;
            }
            if (this.layout.displayMode == MODE_LIST
                && !this.$current.hasClass('yarr_open')
            ) {
                return;
            }
            this.$current.find('a[class="yarr-link"]')[0].click();
        }
    });
    
    
    function Entry (entries, $el) {
        var thisEntry = this;
        this.entries = entries;
        this.index = $el.index();
        this.pk = $el.data('yarr-pk');
        
        // Detect state
        this.read = $el.data('yarr-read');
        this.saved = $el.data('yarr-saved');
        
        // Enhance entry with javascript
        this.setup();
        
        // Find elements and handle clicks
        this.$content = $el.find('.yarr_entry_content')
            .click(function (e) { return thisEntry.onContentClick(e); })
        ;
        this.$li = $el.find('.yarr_entry_li')
            .click(function (e) { return thisEntry.onListClick(e); })
        ;
    }
    Entry.prototype = $.extend(Entry.prototype, {
        setup: function () {
            /** Convert a static HTML entry to ajax-ready controls */
            var thisEntry = this;
            
            // Build toggle buttons
            this.$read = this._mkCheckbox('read', this.read)
                .change(function () {
                    thisEntry.changeState(OP_READ);
                })
            ;
            this.$saved = this._mkCheckbox('saved', this.saved)
                .change(function () {
                    thisEntry.changeState(OP_SAVE);
                })
            ;
            
            // Add buttons
            this.$el.find('.yarr_entry_control')
                .empty()
                .append(this._wrapCheckbox($read, 'yarr_checkbox_read', 'Read'))
                .append(this._wrapCheckbox($saved, 'yarr_checkbox_saved', 'Saved'))
            ;
            
            // When images load, update the position cache
            $entry.find('img').load(this.entries.entriesResized);
        },
        changeState: function (op) {
            var $box = $(this),
                state = $box.prop('checked'),
                $other = (op == OP_READ) ? this.$saved : this.$read,
                data
            ;
            
            // If true, the other field must be false
            if (state) {
                $other.prop('checked', false);
            }
            this.$el.attr('data-yarr-read', this.$read.prop('checked'));
            this.read = this.$read.prop('checked');
            this.saved = this.$saved.prop('checked');
            
            // Update class
            if (this.$read.prop('checked')) {
                this.$el.addClass('yarr_read');
            } else {
                this.$el.removeClass('yarr_read');
            }
            
            // Save the state
            if (op == OP_READ) {
                this.markRead();
            } else {
                this.markSaved();
            }
            this.saveState(op);
        },
        
        markRead: function (data) {
            Yarr.API.entry_read(this);
        },
        markSaved: function (data) {
            Yarr.API.entry_saved(this);
        },
        
        saveState: function (op) {
            /** The state of the entry has changed, update on server */
            // Prep data
            data = {
                'entry_pks': [this.pk].join(','),
                'op':       op,
                'is_read':  this.read,
                'is_saved': this.saved
            };
            
            // Update the server
            apiCall(apiEntrySet, data, function(result) {
                // Update unread count in the feed list.
                var counts = result['feed_unread'];
                for (var pk in counts) {
                    var count = counts[pk];
                    thisEntries.layout.$feedList.find(
                        '[data-yarr-feed=' + pk + ']'
                    ).each(function() {
                        $(this)
                            .toggleClass('yarr_feed_unread', count !== 0)
                            .find('.yarr_count_unread').text(count);
                    });
                }
            });
        },
        
        onListClick: function (e) {
            if (this.$el.hasClass('yarr_open')) {
                this.$el.removeClass('yarr_open');
            } else {
                entries.selectEntry(this.$el.index());
                // Since everything has shifted around we need to scroll to
                // a known position or the user will be lost.
                entries.scrollCurrent();
            }
        },
        onContentClick: function (e) {
            this.entries.selectEntry(this.index);
        },
        
        /* Internal util fns */
        _mkCheckbox: function (name, state) {
            /** Build a checkbox */
            return $('<input type="checkbox" name="' + name + '"/>')
                .prop('checked', state)
            ;
        },
        
        _wrapCheckbox: function ($box, cls, label) {
            /** Wrap a checkbox in a label */
            return $('<label><span>' + label + '</span></label>')
                .prepend($box)
                .wrap('<li />')
                .parent()
                .addClass(cls)
            ;
        }
    });
    
    
    
    
    /**************************************************************************
    **                                                          Functions
    */

     
        
    function apiCall(url, data, successFn, failFn) {
        if (!url) {
            Yarr.Status.set('API disabled');
            return;
        }
        
        /** Make a call to the API */
        $.getJSON(url, data)
            .done(function(json) {
                Yarr.Status.set(json.msg, !json.success);
                if (successFn) {
                    successFn(json);
                }
            })
            .fail(function(jqxhr, textStatus, error ) {
                Yarr.Status.set(textStatus + ': ' + error, true);
                if (failFn) {
                    failFn(textStatus);
                }
            })
        ;
    }
    
    
    
    
    
    
    
    
    
    
    
    /**************************************************************************
    **                                                          Initialise
    */
    
    // Set up page
    var layout = new Layout(options);
    
    
    
    
    /**************************************************************************
    **                                                     Bind event handlers
    */
    
    // Key presses
    var KEY_N = 78,
        KEY_P = 80,
        KEY_J = 74,
        KEY_K = 75,
        KEY_V = 86,
        KEY_RET = 13
    ;
    $('body').keydown(function (e) {
        /** Event handler for keypresses */
        if (e.which == KEY_N || e.which == KEY_J) {
            selectNext();
        } else if (e.which == KEY_P || e.which == KEY_K) {
            selectPrevious();
        } else if (e.which == KEY_V || e.which == KEY_RET) {
            clickCurrent();
        } else {
            return;
        }
        e.preventDefault();
    });
});
