# My Jekyll Blog

This is a simple blog project created using Jekyll and hosted on GitHub Pages. Below are the details and instructions for setting up and using the blog.

## Project Structure

The project has the following structure:

```
my-jekyll-blog
├── _posts
│   └── 2024-06-13-welcome-to-my-blog.md
├── _layouts
│   └── default.html
├── _includes
│   └── header.html
├── _sass
│   └── main.scss
├── assets
│   ├── css
│   │   └── style.scss
│   └── js
│       └── main.js
├── index.md
├── about.md
├── _config.yml
└── README.md
```

## Setup Instructions

1. **Clone the Repository**: 
   Clone this repository to your local machine using the following command:
   ```
   git clone https://github.com/yourusername/my-jekyll-blog.git
   ```

2. **Navigate to the Project Directory**:
   ```
   cd my-jekyll-blog
   ```

3. **Install Jekyll**:
   Make sure you have Ruby and Bundler installed. Then, install Jekyll by running:
   ```
   gem install jekyll bundler
   ```

4. **Install Dependencies**:
   Run the following command to install the necessary gems:
   ```
   bundle install
   ```

5. **Run the Jekyll Server**:
   Start the Jekyll server with:
   ```
   bundle exec jekyll serve
   ```
   Your site will be available at `http://localhost:4000`.

## Usage

- **Creating New Posts**: Add new blog posts in the `_posts` directory. Follow the naming convention `YYYY-MM-DD-title.md` for the filename.
- **Customizing Layouts**: Modify the `_layouts/default.html` file to change the overall layout of your blog.
- **Adding Styles**: Update the `_sass/main.scss` and `assets/css/style.scss` files to customize the appearance of your blog.
- **JavaScript Functionality**: Use the `assets/js/main.js` file to add interactivity to your blog.

## License

This project is licensed under the MIT License. See the LICENSE file for details.