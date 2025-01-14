module.exports = function (grunt) {
  grunt.initConfig({
    nodemon: {
	  dev: {
		script: 'app.js'
	  }
	},
    watch: {
      server: {
        files: ['modules/**/*.js', 'config/**/*.js', 'Gruntfile.js', 'app.js'],
        options: {
          spawn: false
        }
      }
    },
    concurrent: {
      default: {
        tasks: ['nodemon', 'watch'],
        options: {
          logConcurrentOutput: true
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-concurrent');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-nodemon');
  
  grunt.registerTask('default', ['concurrent']);
};
