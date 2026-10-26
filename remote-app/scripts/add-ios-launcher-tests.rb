require 'xcodeproj'
require 'fileutils'

project_path = 'ios/launcher/BMUXLauncherTests.xcodeproj'
FileUtils.mkdir_p(File.dirname(project_path))
project = Xcodeproj::Project.new(project_path)
tests = project.new_target(:ui_test_bundle, 'BMUXLauncherTests', :ios, '16.4')
group = project.main_group.new_group('BMUXLauncherTests', '../../scripts')
tests.source_build_phase.add_file_reference(group.new_file('ios-launcher-tests.swift'))
tests.build_configurations.each do |configuration|
  configuration.build_settings.merge!(
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'cc.bmux.remote.launcher-tests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1,2'
  )
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(tests)
scheme.add_test_target(tests)
scheme.save_as(project_path, 'BMUXLauncherTests')
