require 'xcodeproj'

project_path = 'ios/bmuxremote.xcodeproj'
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |target| target.name == 'bmuxremote' }
tests = project.new_target(:ui_test_bundle, 'BMUXLauncherTests', :ios, '16.4')
tests.add_dependency(app)
group = project.main_group.new_group('BMUXLauncherTests', '../scripts')
tests.source_build_phase.add_file_reference(group.new_file('ios-launcher-tests.swift'))
tests.build_configurations.each do |configuration|
  configuration.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'cc.bmux.remote.launcher-tests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'TEST_TARGET_NAME' => app.name
  )
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.set_launch_target(app)
scheme.save_as(project_path, 'BMUXLauncherTests')
