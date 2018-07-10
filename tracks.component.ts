import {
    AfterViewInit, Component, EventEmitter, Inject, Input, OnDestroy, OnInit, Output,
    ViewChild
} from '@angular/core';
import {
    MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatInput, MatPaginator, MatSelect, MatSort, MatTableDataSource,
    PageEvent
} from '@angular/material';
import {SelectionChange, SelectionModel} from '@angular/cdk/collections';
import {TranslatePipe, TranslateService} from '@ngx-translate/core';
import {NavigationExtras, Router} from '@angular/router';
import {TrackboxService} from '../trackbox.service';
import {Track} from '../model/track/track';
import {Observable} from 'rxjs/Observable';
import 'rxjs/add/operator/debounceTime';
import 'rxjs/add/operator/distinctUntilChanged'; //
import 'rxjs/add/observable/merge';
import 'rxjs/add/observable/of';
import 'rxjs/add/operator/catch';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/startWith';
import 'rxjs/add/operator/switchMap';
import {AppConfig} from '../config/app.config';
import {FileItem, FileUploader} from 'ng2-file-upload';
import {Utils} from '../core/Utils';
import {MessageService} from '../message.service';
import {TrackDetailComponent} from './track-detail/track-detail.component';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {AgmMap, LatLngBoundsLiteral} from '@agm/core';
import {isNull, isNullOrUndefined} from 'util';
import {DatePipe, DecimalPipe} from '@angular/common';
import {TrackProcessor} from '../model/track/trackProcessor';
import {UserSettings} from '../user/user-settings';
import {User} from '../user/user';
import {SpeedPipe} from '../core/speed-pipe';
import {DistancePipe} from '../core/distance-pipe';
import {IDisabledInterval} from 'tslint';
import {IntervalPipe} from '../core/interval-pipe';
import {TracksCacheService} from '../tracks-cache.service';
import {MapViewComponent} from '../core/map-view/map-view.component';
import {IServiceResponse} from '../core/IServiceResponse';
import {DateUtils} from '../core/DateUtils';



@Component({
  selector: 'app-tracks',
  templateUrl: './tracks.component.html',
  styleUrls: ['./tracks.component.css']
})
export class TracksComponent implements OnInit, AfterViewInit, OnDestroy {

    displayedColumns = ['select', 'name', 'start_time', 'total_distance', 'total_time', 'tag', 'goto'];
    tracksDatabase: TracksDatabase | null;

    dataSource = new MatTableDataSource<Track>();

    selection = new SelectionModel<Track>(true, []);
    filter = '';
    private filterPipe;

    onSelect: Observable<any>;
    menuItems: any[];
    // private translateService: TranslateService;

    @Output() shiftColumns = new EventEmitter<void>();
    @Output() toggleColorColumn = new EventEmitter<void>();

    resultsLength = 0;

    private isLoadingResults$ = new BehaviorSubject<boolean>(false);

    @ViewChild(MatPaginator) paginator: MatPaginator;
    @ViewChild(MatSort) sort: MatSort;
    @ViewChild(MatSelect) dateRange: MatSelect;

    sortActive = 'start_time';
    sortDirection = 'desc';

    pageSizeOptions = [10, 25, 50, 100];

    mapBounds: LatLngBoundsLiteral = {
        east: 90,
        west: -90,
        north: 60,
        south: -60
    };

    mapTrack: Track;
    events: any;
    points: any[] = [];
    lines: any[] = [];

    valueColor = 'rgba(250, 250, 250, 1)';
    valueSize = '1.5em';

    avr_speed = 0;
    avr_moving_speed = 0;
    moving_time = 0;
    elevation_min = 0;
    elevation_max = 0;

    select = {
        tracks: 0,
        totalTime: 0,
        totalDistance: 0,
        avrSpeed: 0,
        maxSpeed: 0
    };

    @ViewChild(MapViewComponent) mapView: MapViewComponent;
    settings: UserSettings;

    displayDate = 'total';
    displayDateRange;
    displayDates = [
        {value: 'today', viewValue: 'today'},
        {value: 'yesterday', viewValue: 'yesterday'},
        {value: 'week', viewValue: 'thisWeek'},
        {value: 'month', viewValue: 'month2date'},
        {value: 'last7', viewValue: 'last7'},
        {value: 'last30', viewValue: 'last30'},
        {value: 'thisYear', viewValue: 'thisYear'},
        {value: 'total', viewValue: 'time2date'},
        {value: 'custom', viewValue: 'custom'}
    ];

    constructor(private trackboxService: TrackboxService,
                private tracksCacheService: TracksCacheService,
                private router: Router,
                private decimalPipe: DecimalPipe,
                private speedPipe: SpeedPipe,
                private distancePipe: DistancePipe,
                private intervalPipe: IntervalPipe,
                private datePipe: DatePipe,
                private dialog: MatDialog,
                private translateService: TranslateService,
                private messageService: MessageService) {
        this.select.tracks = 0;
        this.tracksDatabase = new TracksDatabase(this.trackboxService);
        this.settings = User.loadUserData().settings;
        this.loadMenus();
    }

    ngOnInit() {
        const state = JSON.parse(localStorage.getItem('tracksState'));

        if (state !== undefined) {
            this.sortActive = state.active;
            this.sortDirection = state.dir;
            this.paginator.pageIndex = state.from;
            this.paginator.pageSize = state.pageSize;
            this.resultsLength = state.max;
            this.filter = state.filter;
            this.sort.sort({disableClear: false, id: state.active, start: state.dir});

            if (!isNullOrUndefined(state.displayDate)) {
                this.displayDate = state.displayDate;
                this.displayDateRange = state.displayDateRange;
                this.displayDateRange.from = new Date(this.displayDateRange.from);
                this.displayDateRange.to = new Date(this.displayDateRange.to);
            }
        }
    }

    ngAfterViewInit() {
        // If the user changes the sort order, reset back to the first page.
        this.sort.sortChange.subscribe(
            () => this.paginator.pageIndex = 0);

        this.updateTracks(false);

        this.selection.onChange.asObservable().subscribe(event => {
            this.onSelectionChanged(event);
        });

    }

    ngOnDestroy() {
        localStorage.setItem('tracksState', JSON.stringify(
            {active: this.sort.active
                , dir: this.sort.direction
                , from: this.paginator.pageIndex
                , pageSize: this.paginator.pageSize
                , max: this.paginator.length
                , filter: this.filter
                , displayDate: this.displayDate
                , displayDateRange: this.displayDateRange
            }));
    }

    get isLoadingResults() {
        return this.isLoadingResults$.asObservable();
    }

    private updateTracks(selectFirst: boolean) {
        Observable.merge(this.sort.sortChange, this.paginator.page)
            .startWith(null)
            .switchMap(() => {
                this.isLoadingResults$.next(true);
                if (isNullOrUndefined(this.displayDateRange) || isNullOrUndefined(this.displayDateRange.from)) {
                    return this.tracksDatabase!.getPageOfTracks(
                        this.sort.active, this.sort.direction
                        , this.paginator.pageIndex * this.paginator.pageSize
                        , (this.paginator.pageIndex + 1) * this.paginator.pageSize
                        , this.filter);
                } else {
                    return this.tracksDatabase!.getPageOfTracksInTimeRange(
                        this.sort.active, this.sort.direction
                        , this.paginator.pageIndex * this.paginator.pageSize
                        , (this.paginator.pageIndex + 1) * this.paginator.pageSize
                        , this.filter
                        , Utils.dbDate(Utils.ensureDateForDb(this.displayDateRange.from, false))
                        , Utils.dbDate(Utils.ensureDateForDb(this.displayDateRange.to, false))
                    );
                }
            })
            .map((data: { tracks: Track[], total: number }) => {
                // Turn flag to show that loading has finished.
                this.isLoadingResults$.next(false);
                this.resultsLength = data.total; // data.length;
                this.selection.clear();

                this.tracksCacheService.add(data.tracks);
                return data.tracks;
            })
            .catch(() => {
                this.isLoadingResults$.next(false);
                return Observable.of([]);
            })
            .subscribe(data => {
                this.dataSource.data = data;
                if (selectFirst) {
                    this.showOnMap(data[0]);
                } else {
                    const id = this.tracksCacheService.getSelected();

                    for (const track of data) {
                        if (track.id === id) {
                            this.showOnMap(track);
                        }
                    }
                }
            });
    }

    applyFilter(filterValue: string) {
        if (!this.filterPipe) {
            Observable.create(observer => {
                this.filterPipe = observer;
            }).debounceTime(500) // wait 500ms after the last event before emitting last event
                .distinctUntilChanged() // only emit if value is different from previous value
                .subscribe(value => {
                    this.filter = value.trim().toLowerCase();
                    this.paginator.pageIndex = 0; // reset page
                    this.updateTracks(false);
                });
        }

        this.filterPipe.next(filterValue);
    }

    /** Whether all filtered rows are selected. */
    isAllFilteredRowsSelected() {
        return this.dataSource.filteredData.every(data => this.selection.isSelected(data));
    }

    makeDateForDisplay(range: { from: Date; to: Date }, format: string) {
        return this.datePipe.transform(range.from, format) + ' - '
            + this.datePipe.transform(range.to, format);
    }

    getDisplayDate(dateValue: string): string {
        switch (dateValue) {
            case 'today': return this.datePipe.transform(DateUtils.getToday(), 'MMMM d');
            case 'yesterday': return this.datePipe.transform(DateUtils.getYesterday(), 'MMMM d');
            case 'week': {
                    const range = DateUtils.getWeek();
                    return this.makeDateForDisplay(range, 'MMMM d');
                }
            case 'last7': {
                    const range = DateUtils.get7days();
                    return this.makeDateForDisplay(range, 'MMMM d');
                }
            case 'last30': {
                    const range = DateUtils.get30days();
                    return this.makeDateForDisplay(range, 'MMMM d');
                }
            case 'month': {
                    const range = DateUtils.getMonth();
                    return this.makeDateForDisplay(range, 'MMMM d');
                }
            case 'thisYear': {
                    const range = DateUtils.getYear();
                    return this.makeDateForDisplay(range, 'longDate');
                }
            case 'total': {
                return '';
                }
            case 'custom' : {
                if (!isNullOrUndefined(this.displayDateRange)) {
                    return this.makeDateForDisplay(this.displayDateRange, 'longDate');
                }
            }
        }
        return '';
    }

    getFilterDateRange(dateValue: string) {
        switch (dateValue) {
            case 'today': return DateUtils.getTodayRange();
            case 'yesterday': return DateUtils.getYesterdayRange();
            case 'week': return DateUtils.getWeek();
            case 'last7': return  DateUtils.get7days();
            case 'last30': return DateUtils.get30days();
            case 'month': return DateUtils.getMonth();
            case 'thisYear': return DateUtils.getYear();
            case 'total': return {};
        }
        return {};
    }

    onDateChanged(value) {
        if (value === 'custom') {
            this.setCustomDates();
        } else {
            this.displayDateRange = this.getFilterDateRange(value);

            // reset to first page on data range change
            this.paginator.pageIndex = 0;

            this.updateTracks(false);
        }
    }

    isMasterToggleChecked() {
        return this.selection.hasValue() &&
            this.isAllFilteredRowsSelected() &&
            this.selection.selected.length >= this.dataSource.filteredData.length;
    }

    isMasterToggleIndeterminate() {
        return this.selection.hasValue() &&
            (!this.isAllFilteredRowsSelected() || !this.dataSource.filteredData.length);
    }

    masterToggle() {
        if (this.isMasterToggleChecked()) {
            this.selection.clear();
        } else {
            this.dataSource.filteredData.forEach(data => this.selection.select(data));
        }
    }

    msToTime(value) {
        return Utils.msToTime(value);
    }

    private loadMenus(): void {
/*  TODO: define later
        this.menuItems = [
            {link: '/track/add', name: 'add', depends: false},
            // {link: '/' + AppConfig.routes.patients + '/edit', name: texts['edit']},
            {link: '/track/remove', name: 'remove', depends: true},
        ];
*/
    }

    changeLanguage(language: string): void {
        this.translateService.use(language).subscribe(() => {
            this.loadMenus();
        });
    }

    showTrackDetails(track): void {
        // Set our navigation extras object
        // that contains our global query params and fragment
        this.tracksCacheService.select(track.id);
        this.router.navigate(['/track/edit/' + track.id], { queryParams: { } });
        this.messageService.sendMessage(TrackDetailComponent.msgAddress, track);
    }

    showOnMap(track): void {
        if (this.selection.selected.length !== 0) {
            return;
        }

        this.mapTrack = track;

        this.avr_speed = this.mapTrack.avr_speed;
        this.avr_moving_speed = this.mapTrack.avr_moving_speed;
        this.moving_time = this.mapTrack.moving_time;
        this.elevation_min = this.mapTrack.elevation_min;
        this.elevation_max = this.mapTrack.elevation_max;

        if (isNullOrUndefined(track.track)) {
            this.trackboxService.getTrackBlob(track.id).subscribe((result: IServiceResponse) => {
                if (isNullOrUndefined(result.error)) {
                    track.track = JSON.parse(result.result);
                    this.mapView.removeAll();
                    this.mapView.add(track);
                }
            });
        } else {
            this.mapView.removeAll();
            this.mapView.add(track);
        }
    }

    onUpdateMap() {
    }

    import() {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.token) {
            const dialogRef = this.dialog.open(ImportTracksDialogComponent,
                {width: '80%', data: {token: currentUser.token}}
            );
            dialogRef.afterClosed().subscribe(result => {
                // update tracks list
                this.updateTracks(false);
            });
        }
    }

    setCustomDates() {
        const dialogRef = this.dialog.open(DateRangeDialogComponent,
            {width: '700sp', data: {from: new Date(2012, 0, 1), to: new Date()}}
        );
        dialogRef.afterClosed().subscribe(result => {
            console.log(`Dialog result: ${JSON.stringify(result)}`);

            if (!isNullOrUndefined(result) && !isNullOrUndefined(result.from)) {
                this.displayDateRange = result;

                this.displayDate = 'custom';

                // update tracks list
                this.updateTracks(false);
            }
        });
    }

    getColor(speed: number) {
        return TrackProcessor.getSpeedColor(speed);
    }


    private onSelectionChanged(event: SelectionChange<Track>) {
        if (event.added.length > 0) {
            if (!isNullOrUndefined(this.mapTrack)) {
                // remove map track
                this.mapView.removeAll();
                this.mapTrack = null;
            }
            for (const track of event.added) {
                if (isNullOrUndefined(track.track)) {
                    this.trackboxService.getTrackBlob(track.id).subscribe((result: IServiceResponse) => {
                        if (isNullOrUndefined(result.error)) {
                            track.track = JSON.parse(result.result);
                            this.mapView.add(track);
                        }
                    });
                } else {
                    this.mapView.add(track);
                }
            }
        }
        if (event.removed.length > 0) {
            for (const track of event.removed) {
                this.mapView.remove(track);
            }
        }
        this.updateSelectedData();
    }

    private updateSelectedData() {
        let totalTime = 0;
        let totalDistance = 0;
        let avrSpeed = 0;
        let maxSpeed = 0;

        for (const track of this.selection.selected) {
            totalTime += track.total_time;
            totalDistance += track.total_distance;
            avrSpeed += track.avr_speed * track.total_time;
            maxSpeed = track.max_speed > maxSpeed ? track.max_speed : maxSpeed;
        }
        avrSpeed /= totalTime;

        this.select.tracks = this.selection.selected.length;
        this.select.avrSpeed = avrSpeed;
        this.select.maxSpeed = maxSpeed;
        this.select.totalDistance = totalDistance;
        this.select.totalTime = totalTime;
    }

    // remove selected tracks
    remove() {
        let count: number = this.selection.selected.length;
        for (const track of this.selection.selected) {
            this.trackboxService.deleteTrack(track.id).subscribe( res => {
                this.translateService.get('trackDeleted', {'value': track.name})
                    .subscribe((texts) => {
                        this.trackboxService.showDirectSnackBar(texts);
                        if ( --count === 0 ) {
                            this.updateTracks(true);
                        }
                    });
            });
        }
    }
}

export class TracksDatabase {
    constructor(private trackboxService: TrackboxService) {
    }

    getPageOfTracks(sort: string, order: string, from: number, to: number, filter: string): Observable<{tracks: Track[], total: number}> {
        return (this.trackboxService.getTracksRange(from, to, sort, order, filter)
            .map((data: IServiceResponse) => data.result));
    }

    getPageOfTracksInTimeRange(sort: string, order: string, from: number, to: number, filter: string, fromDate: string, toDate: string):
    Observable<{tracks: Track[], total: number}> {
        return (this.trackboxService.getTracksInDateRange(from, to, sort, order, filter, fromDate, toDate)
            .map((data: IServiceResponse) => data.result));
    }
}

@Component({
    selector: 'app-import-track-dialog',
    templateUrl: './import-track.dialog.html',
    styles: [
        '.file-size { color: #888888; margin-left: 8px}'
        , '.add-button { text-align: left; align-items: center;}'
    ]
})

export class ImportTracksDialogComponent {
    @Input() uploader: FileUploader; // = new FileUploader({url: URL});
    public hasBaseDropZoneOver = false;
    public hasAnotherDropZoneOver = false;

    constructor(@Inject(MAT_DIALOG_DATA) public data: any) {
        this.uploader = new FileUploader({url: AppConfig.settings.endpoints.api + AppConfig.settings.routes.tracks + '/import'
            , disableMultipart: false});
        this.uploader.onAfterAddingFile = (file) => { file.withCredentials = false; };
        this.uploader.onBeforeUploadItem = (file: FileItem) => {
            file.withCredentials = false;
            this.uploader.authToken = this.data.token;
            this.uploader.options.additionalParameter = {
                name: file.file.name
            };
        };
    }

    public fileOverBase(e: any): void {
        this.hasBaseDropZoneOver = e;
    }

    public fileOverAnother(e: any): void {
        this.hasAnotherDropZoneOver = e;
    }

    public submit(form: any) {

    }
}

@Component({
    selector: 'app-date-range-dialog',
    templateUrl: './date-range.dialog.html',
})


export class DateRangeDialogComponent {
    startDate;
    endDate;
    from;
    to;
    constructor(@Inject(MAT_DIALOG_DATA) public data: any) {
        if (isNullOrUndefined(data)) {
            this.startDate = new Date(2012, 0, 1);
            this.endDate = new Date();
        } else {
            this.startDate = data.from;
            this.endDate = data.to;
        }
    }

}
