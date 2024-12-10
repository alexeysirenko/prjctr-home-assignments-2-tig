# Use the official Node.js image as the base image
FROM node:18

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the application source code to the working directory
COPY . .

# Expose the port your app runs on
EXPOSE 4000

# Specify the command to run your app
CMD ["npm", "run", "start"]
