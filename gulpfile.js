

var gulp = require('gulp')
  , babel = require('gulp-babel')
  , eslint = require('gulp-eslint')
  , watch = require('gulp-watch')
  , batch = require('gulp-batch')

gulp.task('babel', function () {
  var stream = gulp.src('src/**/*.js')      // your ES2015 code   
    .pipe(babel())                            // compile new ones
    .pipe(gulp.dest('./dist'))                // write them
  return stream // important for gulp-nodemon to wait for completion
})

gulp.task('lint', () => {
  // ESLint ignores files with "node_modules" paths.
  // So, it's best to have gulp ignore the directory as well.
  // Also, Be sure to return the stream from the task;
  // Otherwise, the task may end before the stream has finished.
  return gulp.src(['src/**/*.js', '!node_modules/**', '!dist/**', '!config/**'])
    // eslint() attaches the lint output to the "eslint" property
    // of the file object so it can be used by other modules.
    .pipe(eslint())
    // eslint.format() outputs the lint results to the console.
    // Alternatively use eslint.formatEach() (see Docs).
    .pipe(eslint.format())
    // To have the process exit with an error code (1) on
    // lint error, return the stream and pipe to failAfterError last.
    .pipe(eslint.failAfterError())
})

gulp.task('watch', function () {
  watch('src/**/*.js', batch(function (events, done) {
    gulp.start('lint', 'babel', done)
  }))
})


